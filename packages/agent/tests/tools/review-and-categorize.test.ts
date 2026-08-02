import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { getDb } from "@clara-financas/db";
import { transactions } from "@clara-financas/db/schema/ledger";
import { transactionReclassifications } from "@clara-financas/db/schema/reclassification";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq } from "drizzle-orm";

import commitBatch from "../../agent/tools/commit_batch";
import listReviewQueue from "../../agent/tools/list_review_queue";
import proposeBatch from "../../agent/tools/propose_batch";
import recategorize from "../../agent/tools/recategorize_transactions";
import saveConcept from "../../agent/tools/save_concept";
import queryLedger from "../../agent/subagents/analyst/tools/query_ledger";
import {
  closeConnections,
  ctxFor,
  dropTenant,
  freshTenant,
  seedDocument,
  viewFromReceipt,
} from "../helpers/harness";

/**
 * O pedido literal que abriu esta investigação:
 *
 *   "o que está para revisar sem categoria e com a descrição próxima a
 *    pagamento, categorize como pagamento de fatura"
 *
 * Ele exigia quatro coisas que não existiam: ver a fila de revisão, buscar por
 * texto aproximado, criar uma categoria que não está na constituição, e
 * aplicá-la. Cada passo abaixo é uma dessas quatro.
 */

let tenantId: string;
let ctx: never;
let batchId: string;

describe("revisar e categorizar o que a extração não fechou", () => {
  before(async () => {
    tenantId = await freshTenant();
    ctx = ctxFor(tenantId);
    const documentId = await seedDocument(tenantId);

    const proposed = (await proposeBatch.execute(
      {
        documentId,
        declaredTotal: 9_000,
        transactions: [
          {
            date: "2026-06-03",
            originalDescription: "PAGTO FATURA ANTERIOR",
            merchant: null,
            amount: -20_000,
            kind: "payment",
            extractionConfidence: "media",
          },
          {
            date: "2026-06-04",
            originalDescription: "Pagamento efetuado — obrigado",
            merchant: null,
            amount: -5_000,
            kind: "payment",
            extractionConfidence: "media",
          },
          {
            date: "2026-06-09",
            originalDescription: "PADARIA CENTRAL",
            merchant: "Padaria Central",
            amount: 9_000,
            kind: "purchase",
            category: "groceries",
            extractionConfidence: "alta",
          },
        ],
      },
      ctx,
    )) as { batchId: string; checksum: { result: string } };

    assert.equal(proposed.checksum.result, "match");
    batchId = proposed.batchId;
    await commitBatch.execute({ batchId }, ctx);
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  it("a fila de revisão chega à conversa, com o motivo de cada item", async () => {
    const queue = (await listReviewQueue.execute({}, ctx)) as {
      pending: number;
      items: Array<{ description: string; reasons: string[] }>;
    };

    // Os dois pagamentos: sem categoria e sem comerciante. A padaria não entra.
    assert.equal(queue.pending, 2);
    assert.ok(queue.items.every((item) => item.reasons.includes("sem_categoria")));

    const filtered = (await listReviewQueue.execute({ reasons: ["sem_comerciante"] }, ctx)) as {
      returned: number;
    };
    assert.equal(filtered.returned, 2);
  });

  it('"descrição próxima a pagamento" encontra as duas grafias', async () => {
    // "PAGTO" e "Pagamento" — caixa diferente, palavra diferente. O
    // `includes()` em memória de antes achava no máximo uma das duas.
    const found = (await viewFromReceipt(
      await queryLedger.execute(
        { search: "pagamento pagto", uncategorizedOnly: true, reviewed: false },
        ctx,
      ),
      ctx,
    )) as { rows: Array<{ label: string; transactionIds: string[] }> };

    assert.equal(found.rows.length, 2);
    assert.ok(found.rows.some((row) => row.label === "PAGTO FATURA ANTERIOR"));
    assert.ok(
      found.rows.some((row) => row.label === "Pagamento efetuado — obrigado"),
    );
  });

  it("a categoria que não existe é criada pela conversa e passa a valer", async () => {
    const found = (await viewFromReceipt(
      await queryLedger.execute({ search: "pagamento pagto", uncategorizedOnly: true }, ctx),
      ctx,
    )) as { rows: Array<{ transactionIds: string[] }> };
    const ids = found.rows.flatMap((row) => row.transactionIds);

    // Antes de existir, a recategorização é recusada — apontando a saída.
    const before = (await recategorize.execute(
      {
        changes: ids.map((id) => ({
          transactionId: id,
          category: "pagamento-de-fatura",
          categoryLabel: "Pagamento de fatura",
        })),
      },
      ctx,
    )) as { error?: { code: string } };
    assert.equal(before.error?.code, "categoria_desconhecida");

    // `save_concept` já existia e aceita `Category`: o que faltava era o resto
    // do caminho chegar até aqui.
    const created = (await saveConcept.execute(
      {
        conceptId: "categories/pagamento-de-fatura",
        type: "Category",
        title: "Pagamento de fatura",
        description: "Pagamentos da própria fatura do cartão.",
        body: "O pagamento da fatura não é consumo: ele quita o que já foi gasto.",
      },
      ctx,
    )) as { action: string };
    assert.equal(created.action, "created");

    const applied = (await recategorize.execute(
      {
        changes: ids.map((id) => ({
          transactionId: id,
          category: "pagamento-de-fatura",
          categoryLabel: "Pagamento de fatura",
        })),
        reason: "Pedido da pessoa: pagamentos vão para a categoria própria.",
      },
      ctx,
    )) as { changed: number };
    assert.equal(applied.changed, 2);

    const rows = await forTenant(
      tenantId,
      async (tx) =>
        tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.tenantId, tenantId),
              eq(transactions.category, "pagamento-de-fatura"),
            ),
          ),
      getDb(),
    );
    assert.equal(rows.length, 2);

    // E a trilha registrou quem mudou o quê — categoria nova não é atalho para
    // escrever sem auditoria.
    const trail = await forTenant(
      tenantId,
      async (tx) =>
        tx
          .select()
          .from(transactionReclassifications)
          .where(eq(transactionReclassifications.tenantId, tenantId)),
      getDb(),
    );
    assert.equal(trail.length, 2);
    assert.ok(trail.every((row) => row.author.startsWith("human:")));
    assert.ok(trail.every((row) => row.previousValue === null));
  });

  it("a fila esvazia quando a categoria e o comerciante deixam de faltar", async () => {
    // Ainda falta comerciante nos dois pagamentos, então a fila não zera —
    // e é isso que o atestado resolve, não uma regra escondida.
    const queue = (await listReviewQueue.execute({}, ctx)) as { pending: number };
    assert.equal(queue.pending, 2);

    const remaining = (await listReviewQueue.execute({ reasons: ["sem_categoria"] }, ctx)) as {
      returned: number;
    };
    assert.equal(remaining.returned, 0);
  });
});
