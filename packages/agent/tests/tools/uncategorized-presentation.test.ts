import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { CategorizationResultSchema } from "@clara-financas/views/agent-contracts";

import commitBatch from "../../agent/tools/commit_batch";
import listReviewQueue from "../../agent/tools/list_review_queue";
import markReviewed from "../../agent/tools/mark_reviewed";
import proposeBatch from "../../agent/tools/propose_batch";
import categorizeByRules from "../../agent/subagents/categorizer/tools/categorize_by_rules";
import listUncategorized from "../../agent/subagents/categorizer/tools/list_uncategorized";
import { loadSnapshot } from "../../agent/lib/snapshot";
import { closeConnections, ctxFor, dropTenant, freshTenant, seedDocument } from "../helpers/harness";

/**
 * A conversa que abriu esta investigação, literal:
 *
 *   — existem itens sem categoria
 *   — Sim. Há 2 itens sem categoria, somando R$ 79,94.
 *   — apresente esses itens
 *   — Consigo, mas preciso consultar os lançamentos sem categoria primeiro.
 *     Tentei puxar isso e a consulta não veio pronta.
 *   — faca isso
 *   — Fiz a triagem, mas a consulta não retornou os 2 itens de forma confiável.
 *
 * O primeiro número estava certo: ele vem do estado do razão, lido do banco a
 * cada turno. O que não existia era caminho do indicador até as LINHAS. Dois
 * defeitos, e cada teste abaixo é um deles:
 *
 *  1. o item sem categoria já ATESTADO conta no indicador e não espera na fila,
 *     então a única consulta direta da coordenadora voltava vazia enquanto o
 *     bloco do turno insistia que havia 2;
 *  2. o contrato do guarda-livros não tinha onde carregar o valor de cada
 *     grupo, e a coordenadora — proibida de calcular — recebia comerciantes sem
 *     dinheiro nenhum e nada para apresentar.
 */

let tenantId: string;
let ctx: never;
let uncategorizedIds: string[];

describe("apresentar os lançamentos sem categoria", () => {
  before(async () => {
    tenantId = await freshTenant();
    ctx = ctxFor(tenantId);
    const documentId = await seedDocument(tenantId);

    // R$ 39,97 + R$ 39,97 = R$ 79,94 — os mesmos dois itens da conversa. O
    // pagamento entra de propósito: ele NÃO é gasto a categorizar, e contá-lo
    // era como o indicador do turno e a triagem discordavam.
    const proposed = (await proposeBatch.execute(
      {
        documentId,
        declaredTotal: 16_988,
        transactions: [
          {
            date: "2026-06-05",
            originalDescription: "PG *IFD1234",
            merchant: null,
            amount: 3_997,
            kind: "purchase",
            extractionConfidence: "alta",
          },
          {
            date: "2026-06-11",
            originalDescription: "PG *IFD9876",
            merchant: null,
            amount: 3_997,
            kind: "purchase",
            extractionConfidence: "alta",
          },
          {
            date: "2026-06-20",
            originalDescription: "PADARIA CENTRAL",
            merchant: "Padaria Central",
            amount: 8_994,
            kind: "purchase",
            category: "groceries",
            extractionConfidence: "alta",
          },
          {
            date: "2026-06-02",
            originalDescription: "PAGTO FATURA ANTERIOR",
            merchant: null,
            amount: -50_000,
            kind: "payment",
            extractionConfidence: "alta",
          },
        ],
      },
      ctx,
    )) as { batchId: string; checksum: { result: string } };

    assert.equal(proposed.checksum.result, "match");
    await commitBatch.execute({ batchId: proposed.batchId }, ctx);
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  it("o indicador do turno e a fila contam as MESMAS linhas", async () => {
    const snapshot = await loadSnapshot(tenantId);
    assert.deepEqual(snapshot.uncategorized, { count: 2, totalCents: 7_994 });

    const queue = (await listReviewQueue.execute({ reasons: ["sem_categoria"] }, ctx)) as {
      returned: number;
      truncated: boolean;
      uncategorizedSpending: {
        count: number;
        totalCents: number;
        totalFormatted: string;
        scope: string;
      };
      items: Array<{ id: string; amountFormatted: string; description: string }>;
    };

    // O que a pessoa pediu: os itens, com data, descrição e valor.
    assert.equal(queue.returned, 2);
    assert.equal(queue.truncated, false);
    assert.deepEqual(
      queue.items.map((item) => item.amountFormatted).sort(),
      ["R$ 39,97", "R$ 39,97"],
    );
    // E o total do indicador na MESMA resposta, para a lista não ser
    // apresentada como se fosse outro recorte.
    assert.deepEqual(queue.uncategorizedSpending, {
      count: 2,
      totalCents: 7_994,
      totalFormatted: "R$ 79,94",
      // Sem `batchId`, o recorte é o razão inteiro — o mesmo do indicador.
      scope: "ledger",
    });

    uncategorizedIds = queue.items.map((item) => item.id);
    assert.equal(uncategorizedIds.length, 2);
  });

  it("o item já atestado ainda é alcançável, e a fila vazia diz como", async () => {
    await markReviewed.execute({ transactionIds: uncategorizedIds }, ctx);

    // O estado do razão não olha `reviewedAt`: continua dizendo 2, e está certo
    // — os lançamentos seguem sem categoria.
    const snapshot = await loadSnapshot(tenantId);
    assert.deepEqual(snapshot.uncategorized, { count: 2, totalCents: 7_994 });

    const empty = (await listReviewQueue.execute({ reasons: ["sem_categoria"] }, ctx)) as {
      returned: number;
      message: string;
      retryWith?: { includeReviewed: boolean };
      uncategorizedSpending: { count: number; totalFormatted: string; scope: string };
    };

    // Aqui morava a contradição: a fila não tem esses itens, e a resposta
    // anterior era "Não há nada esperando revisão" — o oposto do que o bloco do
    // turno afirmava na mesma conversa.
    assert.equal(empty.returned, 0);
    // A resposta vazia é justamente onde o indicador mais faz falta: sem ele, a
    // Clara só tinha "nada aqui" para contrapor ao "há 2" do próprio contexto.
    assert.equal(empty.uncategorizedSpending.count, 2);
    assert.equal(empty.uncategorizedSpending.totalFormatted, "R$ 79,94");
    assert.equal(empty.uncategorizedSpending.scope, "ledger");
    assert.deepEqual(empty.retryWith, { includeReviewed: true });
    assert.match(empty.message, /já os atestou/);
    assert.match(empty.message, /includeReviewed: true/);
    assert.doesNotMatch(empty.message, /Não há nada/);

    const found = (await listReviewQueue.execute(
      { reasons: ["sem_categoria"], includeReviewed: true },
      ctx,
    )) as { returned: number; items: Array<{ amountFormatted: string; reasons: string[] }> };

    assert.equal(found.returned, 2);
    assert.ok(found.items.every((item) => item.reasons.includes("sem_categoria")));
    assert.ok(found.items.every((item) => item.amountFormatted === "R$ 39,97"));

    // A fila continua sendo a fila: `pending` é o que ninguém olhou ainda, e
    // pedir o atestado junto não o infla. Sobra 1 — o pagamento, que espera
    // comerciante, não categoria.
    const withAttested = (await listReviewQueue.execute({ includeReviewed: true }, ctx)) as {
      pending: number;
      items: Array<{ description: string; reasons: string[] }>;
    };
    assert.equal(withAttested.pending, 1);

    // E o pagamento NÃO é "sem categoria": ele não espera nenhuma. Marcá-lo
    // assim é o que fazia a fila devolver 3 itens onde o indicador contava 2.
    const payment = withAttested.items.find((item) =>
      item.description.startsWith("PAGTO FATURA"),
    );
    assert.deepEqual(payment?.reasons, ["sem_comerciante"]);

    // Reabre para não deixar o atestado alterando os testes seguintes.
    await markReviewed.execute({ transactionIds: uncategorizedIds, reopen: true }, ctx);
  });

  it("a triagem devolve o peso de cada grupo, e ele cabe no contrato", async () => {
    const triage = (await listUncategorized.execute({}, ctx)) as {
      uncategorizedCount: number;
      totalCents: number;
      groups: Array<{
        merchant: string;
        count: number;
        totalCents: number;
        totalFormatted: string;
        transactionIds: string[];
      }>;
    };

    assert.equal(triage.uncategorizedCount, 2);
    assert.equal(triage.totalCents, 7_994);

    // O que o guarda-livros devolve é ESTE mapeamento, campo a campo — nenhuma
    // soma feita por modelo. Se o contrato não aceitar, a coordenadora recebe
    // uma falha de validação onde deveria haver a resposta.
    const result = CategorizationResultSchema.safeParse({
      proposals: triage.groups.map((group) => ({
        merchant: group.merchant,
        categoryId: null,
        categoryLabel: null,
        reason: "A descrição não diz o suficiente para escolher uma categoria.",
        count: group.count,
        totalCents: group.totalCents,
        transactionIds: group.transactionIds,
      })),
      uncategorized: { count: triage.uncategorizedCount, totalCents: triage.totalCents },
    });

    assert.equal(result.success, true);
    // E o valor sobrevive à fronteira: é ele que a pessoa lê no painel.
    assert.equal(
      result.data?.proposals.reduce((sum, proposal) => sum + proposal.totalCents, 0),
      7_994,
    );
  });

  it("a simulação das regras conta o mesmo que o indicador do turno", async () => {
    const simulated = (await categorizeByRules.execute({}, ctx)) as {
      empty?: true;
      uncategorizedCount?: number;
      message?: string;
    };

    // Sem regra aprendida a tool para antes — e é o caminho certo. O que não
    // pode voltar é um `uncategorizedCount` de 3, contando o pagamento.
    if (simulated.empty === true) {
      assert.match(simulated.message ?? "", /regras de categorização/);
      return;
    }
    assert.equal(simulated.uncategorizedCount, 2);
  });
});
