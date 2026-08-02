import { randomUUID } from "node:crypto";

import { closeDb, getDb } from "@clara-financas/db";
import { seedConstitution } from "@clara-financas/db/seed-constitution";
import { agentSessions } from "@clara-financas/db/schema/agent-session";
import { documents } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { sql } from "drizzle-orm";

import presentAnalysis from "../../agent/tools/present_analysis";

/**
 * O mínimo para executar uma tool de verdade, contra o banco de verdade.
 *
 * A suíte do agente testava segurança (token, ACL, isolamento) e o TEXTO dos
 * prompts. Nenhuma tool tinha teste: nem `propose_batch`, nem `commit_batch`,
 * nem a recategorização — justamente as que escrevem no razão. O que quebrou em
 * produção não foi o modelo escolhendo errado, foi o contrato entre as tools e
 * o banco, e esse contrato só se prova exercitando-o.
 *
 * Aqui não há modelo. Uma tool é uma função: recebe input validado e um
 * contexto de sessão, escreve no banco. É isso que estes testes chamam — e as
 * asserções olham o BANCO, não o texto de uma resposta.
 */

/**
 * O contexto que `requireTenantCaller` e os gates de aprovação enxergam.
 *
 * O cast fica AQUI, num lugar só: `ToolContext` do eve carrega sandbox, skills
 * e abortSignal que tool nenhuma daqui toca, e montar o objeto inteiro só para
 * satisfazer o tipo seria ruído — além de mentira, porque nada disso é usado.
 */
export function ctxFor(
  tenantId: string,
  userId = "usr_test",
  sessionId = `ses_${tenantId}`,
) {
  const principal = {
    principalType: "user" as const,
    principalId: userId,
    attributes: { tenantId },
  };
  return {
    session: {
      id: sessionId,
      auth: { current: principal, initiator: principal },
    },
  } as never;
}

/**
 * O contexto de um SUBAGENTE — sessão própria, apontando para a do pai.
 *
 * É o que faltava para testar o núcleo do design de artefatos: o especialista
 * grava numa sessão filha e a coordenadora lê da sua. `persistArtifact` usa
 * `ctx.session.parent?.sessionId ?? sessionId` na escrita e
 * `requireSessionCaller(ctx).sessionId` na leitura — as duas pontas só se
 * encontram se o filho declarar quem é o pai.
 *
 * Sem isto, todo teste rodava com pai e filho na MESMA sessão, então os dois
 * lados coincidiam por acidente e o handoff nunca era exercitado. Um mecanismo
 * central sem cobertura é um mecanismo que ninguém sabe se funciona.
 */
export function ctxForChild(parentCtx: never, childSessionId = `ses_child_${randomUUID().slice(0, 8)}`) {
  const parent = parentCtx as unknown as {
    session: { id: string; auth: unknown };
  };
  return {
    session: {
      id: childSessionId,
      parent: { sessionId: parent.session.id },
      auth: parent.session.auth,
    },
  } as never;
}

/** Um tenant novo, com a constituição semeada (as categorias válidas). */
export async function freshTenant(): Promise<string> {
  const tenantId = `tnt_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await seedConstitution(tenantId, getDb());
  await forTenant(
    tenantId,
    async (tx) => {
      await tx.insert(agentSessions).values({
        sessionId: `ses_${tenantId}`,
        tenantId,
        userId: "usr_test",
      });
    },
    getDb(),
  );
  return tenantId;
}

/** Um documento registrado, que é o que `propose_batch` exige existir antes. */
export async function seedDocument(
  tenantId: string,
  overrides: {
    filename?: string;
    issuer?: string | null;
    /** Extrato e nota fiscal também viram lote — e não são "a última fatura". */
    kind?: "credit_card_invoice" | "bank_statement" | "invoice_nfe";
  } = {},
): Promise<string> {
  const id = `doc_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await forTenant(
    tenantId,
    async (tx) => {
      await tx.insert(documents).values({
        id,
        tenantId,
        kind: overrides.kind ?? "credit_card_invoice",
        blobKey: `${tenantId}/${id}.pdf`,
        filename: overrides.filename ?? "fatura.pdf",
        issuer: overrides.issuer === undefined ? "Nubank" : overrides.issuer,
        contentHash: randomUUID().replace(/-/g, ""),
      });
    },
    getDb(),
  );
  return id;
}

/**
 * As tabelas que guardam rastro de um tenant, na ordem em que podem sair.
 *
 * Lista explícita, como em `scripts/reset-ledger.ts` e pela mesma razão: uma
 * tabela nova que guarde dado de teste precisa aparecer aqui, e só uma lista
 * escrita à mão torna a omissão visível numa revisão.
 */
const TENANT_TABLES = [
  "conversation_artifacts",
  "decision_proposals",
  "agent_tasks",
  "conversation_goals",
  "agent_sessions",
  "agent_artifacts",
  "transaction_reclassifications",
  "financial_action_proposals",
  "transactions",
  "batches",
  "extraction_stagings",
  "documents",
  "concept_revisions",
  "concepts",
  "commitments",
  "notifications",
] as const;

/**
 * Apaga o rastro do tenant de teste.
 *
 * Esta função NUNCA funcionou. Ela fazia `return` silencioso quando
 * `DATABASE_ADMIN_URL` estava ausente — e estava, no `.env` do agente — então
 * a suíte passava verde enquanto deixava um tenant inteiro para trás a cada
 * execução (261 deles, e 3458 conceitos órfãos, quando isto foi medido). Com a
 * credencial presente ela também não funcionava: o `DELETE` esbarra nos
 * triggers `clara_transactions_immutable_trigger` e
 * `clara_batches_immutable_trigger`, que recusam apagar fato já confirmado.
 * Código escrito, nunca exercitado.
 *
 * A limpeza suspende os guards por SESSÃO, com `session_replication_role`.
 * A alternativa óbvia — `ALTER TABLE ... DISABLE TRIGGER` — foi tentada e
 * medida: ela toma ACCESS EXCLUSIVE nas duas tabelas, e como o runner do Node
 * executa os arquivos de teste em paralelo, a suíte inteira serializa e estoura
 * o tempo (3 minutos e timeouts, contra 4 segundos). O ajuste de sessão não
 * pega lock nenhum e não enxerga as outras conexões.
 *
 * Três coisas tornam isso aceitável, e as três são deliberadas:
 *
 *  1. **É `SET LOCAL`.** Vale só até o fim desta transação, nesta conexão, que
 *     é fechada logo abaixo. Nada sobrevive ao escopo, nem se o processo morrer.
 *  2. **Só alcança tenant de teste.** A trava de prefixo abaixo é a diferença
 *     entre "o harness limpa o que ele mesmo criou" e "existe uma função que
 *     apaga razão confirmado". Ela recusa qualquer id que `freshTenant` não
 *     poderia ter gerado.
 *  3. **Não afrouxa o caminho de produção.** O guard continua valendo para
 *     toda escrita da aplicação; o que existe aqui é o equivalente por tenant
 *     do `TRUNCATE` que `scripts/reset-ledger.ts` já usa pelo mesmo motivo —
 *     um jeito explícito, auditável e de propriedade do dono do schema de
 *     recomeçar do zero.
 *
 * Exige que o papel de dono possa ajustar o parâmetro: superuser já pode, e
 * `dev-db.sh`/`ci-db.sh` dão o `GRANT SET ON PARAMETER` ao `clara_owner`.
 */
export async function dropTenant(tenantId: string): Promise<void> {
  const admin = process.env.DATABASE_ADMIN_URL;
  if (admin === undefined || admin === "") {
    throw new Error(
      "DATABASE_ADMIN_URL não está definida — o tenant de teste não pode ser apagado " +
        "(os triggers de imutabilidade recusam a limpeza pelo papel de aplicação). " +
        "Rode ./scripts/dev-db.sh, ou defina a credencial de dono no ambiente.",
    );
  }

  // A trava que sustenta o item 2 acima. `freshTenant` só emite este prefixo.
  if (!tenantId.startsWith("tnt_test_")) {
    throw new Error(
      `dropTenant desliga os guards de imutabilidade e só pode alcançar tenant de teste ` +
        `(prefixo "tnt_test_"); recebeu "${tenantId}".`,
    );
  }

  const { createDbClient } = await import("@clara-financas/db");
  const connection = createDbClient(admin);
  try {
    await connection.db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      for (const table of TENANT_TABLES) {
        await tx.execute(sql`delete from ${sql.identifier(table)} where tenant_id = ${tenantId}`);
      }
    });
  } finally {
    await connection.client.end({ timeout: 5 });
  }
}

/** Fecha a conexão do singleton, senão a suíte termina e o processo não sai. */
export async function closeConnections(): Promise<void> {
  await closeDb();
}

/** Resolve um recibo analítico pelo mesmo caminho usado pela coordenadora. */
export async function viewFromReceipt(receipt: unknown, ctx: never) {
  return (await viewsFromReceipt(receipt, ctx))[0]!;
}

/** Todos os painéis de um recibo — a forma que o contrato passou a permitir. */
export async function viewsFromReceipt(receipt: unknown, ctx: never) {
  const artifactIds = (receipt as { artifactIds?: string[] }).artifactIds;
  if (artifactIds === undefined || artifactIds.length === 0) {
    throw new Error(`analysis receipt without artifactIds: ${JSON.stringify(receipt)}`);
  }
  const presented = (await presentAnalysis.execute({ artifactIds }, ctx)) as {
    views?: unknown[];
    error?: unknown;
  };
  if (presented.error !== undefined || presented.views === undefined) {
    throw new Error(`analysis artifact could not be presented: ${JSON.stringify(presented.error)}`);
  }
  return presented.views as Array<Record<string, unknown>>;
}
