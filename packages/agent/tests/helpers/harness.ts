import { randomUUID } from "node:crypto";

import { closeDb, getDb } from "@clara-financas/db";
import { seedConstitution } from "@clara-financas/db/seed-constitution";
import { documents } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { sql } from "drizzle-orm";

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
export function ctxFor(tenantId: string, userId = "usr_test") {
  const principal = {
    principalType: "user" as const,
    principalId: userId,
    attributes: { tenantId },
  };
  return { session: { auth: { current: principal, initiator: principal } } } as never;
}

/** Um tenant novo, com a constituição semeada (as categorias válidas). */
export async function freshTenant(): Promise<string> {
  const tenantId = `tnt_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await seedConstitution(tenantId, getDb());
  return tenantId;
}

/** Um documento registrado, que é o que `propose_batch` exige existir antes. */
export async function seedDocument(
  tenantId: string,
  overrides: { filename?: string; issuer?: string | null } = {},
): Promise<string> {
  const id = `doc_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await forTenant(
    tenantId,
    async (tx) => {
      await tx.insert(documents).values({
        id,
        tenantId,
        kind: "credit_card_invoice",
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
 * Apaga o rastro do tenant de teste.
 *
 * Como dono do schema, porque o trigger de imutabilidade recusa apagar
 * transação confirmada — a mesma razão pela qual `db:reset` usa TRUNCATE. Sem
 * isto cada execução deixaria um razão órfão no banco de desenvolvimento.
 */
export async function dropTenant(tenantId: string): Promise<void> {
  const admin = process.env.DATABASE_ADMIN_URL;
  if (admin === undefined || admin === "") return;

  const { createDbClient } = await import("@clara-financas/db");
  const connection = createDbClient(admin);
  try {
    for (const table of [
      "transaction_reclassifications",
      "transactions",
      "batches",
      "documents",
      "concept_revisions",
      "concepts",
      "commitments",
      "notifications",
    ]) {
      await connection.db.execute(
        sql`delete from ${sql.identifier(table)} where tenant_id = ${tenantId}`,
      );
    }
  } finally {
    await connection.client.end({ timeout: 5 });
  }
}

/** Fecha a conexão do singleton, senão a suíte termina e o processo não sai. */
export async function closeConnections(): Promise<void> {
  await closeDb();
}
