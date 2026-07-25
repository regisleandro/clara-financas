import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { eq, sql } from "drizzle-orm";

import { createDbClient, type Database } from "./index";
import { batches, documents, transactions } from "./schema/ledger";
import { forTenant } from "./tenant-scope";

/**
 * Imutabilidade do razão confirmado.
 *
 * A hipótese H5 diz que todo número é reproduzível. Isso não depende só da
 * aritmética estar certa: se uma transação já confirmada pudesse ser editada,
 * recalcular no futuro daria outro resultado e a proveniência seria ficção.
 *
 * A garantia mora num trigger, não em disciplina de código — disciplina exige
 * que todo mundo lembre, para sempre.
 */

const TENANT = `tnt_imut_${randomUUID().slice(0, 8)}`;
const OTHER = `tnt_imut_outro_${randomUUID().slice(0, 8)}`;

let db: Database;
let close: () => Promise<void>;

const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

/**
 * O Drizzle embrulha o erro do Postgres num "Failed query: ...", então a
 * mensagem do trigger fica em `cause`. Comparar só a mensagem do topo faria o
 * teste falhar mesmo com a garantia funcionando — ou, pior, passar por outro
 * motivo qualquer.
 */
function rejectsWith(pattern: RegExp) {
  return (error: unknown) => {
    const messages: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) {
      messages.push(current.message);
      current = (current as { cause?: unknown }).cause;
    }
    assert.ok(
      messages.some((message) => pattern.test(message)),
      `nenhuma mensagem da cadeia casou com ${pattern}. Cadeia: ${messages.join(" <- ")}`,
    );
    return true;
  };
}

async function createBatch(tenantId: string, status: "proposed" | "confirmed" = "proposed") {
  const documentId = id("doc");
  const batchId = id("bat");
  const transactionId = id("txn");

  await forTenant(
    tenantId,
    async (tx) => {
      await tx.insert(documents).values({
        id: documentId,
        tenantId,
        kind: "credit_card_invoice",
        blobKey: `${tenantId}/fatura.pdf`,
        filename: "fatura.pdf",
        contentHash: randomUUID(),
      });
      await tx.insert(batches).values({
        id: batchId,
        tenantId,
        documentId,
        status: "proposed",
        declaredTotal: 10000,
        extractedTotal: 10000,
        checksumResult: "match",
      });
      await tx.insert(transactions).values({
        id: transactionId,
        tenantId,
        batchId,
        status: "proposed",
        date: "2026-06-14",
        originalDescription: "MERCADO SANTA LUZIA",
        amount: 10000,
        extractionConfidence: "alta",
        sourceDocumentId: documentId,
        page: 1,
      });

      if (status === "confirmed") {
        await tx
          .update(transactions)
          .set({ status: "confirmed" })
          .where(eq(transactions.id, transactionId));
        await tx.update(batches).set({ status: "confirmed" }).where(eq(batches.id, batchId));
      }
    },
    db,
  );

  return { documentId, batchId, transactionId };
}

describe("imutabilidade do razão", () => {
  before(async () => {
    const connection = createDbClient();
    db = connection.db;
    close = async () => {
      await connection.client.end({ timeout: 5 });
    };
  });

  after(async () => {
    for (const tenantId of [TENANT, OTHER]) {
      await forTenant(
        tenantId,
        async (tx) => {
          // Rascunhos saem; confirmados ficam — o trigger impede apagá-los, e
          // é exatamente esse o comportamento sob teste.
          await tx.execute(
            sql`delete from transactions where tenant_id = ${tenantId} and status = 'proposed'`,
          );
        },
        db,
      );
    }
    await close();
  });

  it("rascunho pode ser editado — é o que permite o botão Corrigir", async () => {
    const { transactionId } = await createBatch(TENANT);

    await forTenant(
      TENANT,
      async (tx) =>
        tx
          .update(transactions)
          .set({ category: "groceries", merchant: "Mercado Santa Luzia" })
          .where(eq(transactions.id, transactionId)),
      db,
    );

    const [row] = await forTenant(
      TENANT,
      async (tx) => tx.select().from(transactions).where(eq(transactions.id, transactionId)),
      db,
    );

    assert.equal(row?.category, "groceries");
  });

  it("transação confirmada NÃO pode ser alterada", async () => {
    const { transactionId } = await createBatch(TENANT, "confirmed");

    await assert.rejects(
      () =>
        forTenant(
          TENANT,
          async (tx) =>
            tx.update(transactions).set({ amount: 1 }).where(eq(transactions.id, transactionId)),
          db,
        ),
      rejectsWith(/não pode ser alterada/),
      "o trigger deveria recusar a edição de transação confirmada",
    );
  });

  it("transação confirmada NÃO pode ser apagada", async () => {
    const { transactionId } = await createBatch(TENANT, "confirmed");

    await assert.rejects(
      () =>
        forTenant(
          TENANT,
          async (tx) => tx.delete(transactions).where(eq(transactions.id, transactionId)),
          db,
        ),
      rejectsWith(/não pode ser apagada/),
    );
  });

  it("correção se faz por linha de ajuste apontando para a original", async () => {
    const { batchId, documentId, transactionId } = await createBatch(TENANT, "confirmed");
    const adjustmentId = id("txn");

    await forTenant(
      TENANT,
      async (tx) =>
        tx.insert(transactions).values({
          id: adjustmentId,
          tenantId: TENANT,
          batchId,
          status: "adjustment",
          date: "2026-06-20",
          originalDescription: "AJUSTE: valor relido",
          amount: -500,
          kind: "adjustment",
          extractionConfidence: "alta",
          sourceDocumentId: documentId,
          adjustsTransactionId: transactionId,
        }),
      db,
    );

    const rows = await forTenant(
      TENANT,
      async (tx) => tx.select().from(transactions).where(eq(transactions.batchId, batchId)),
      db,
    );

    assert.equal(rows.length, 2, "a original permanece; o ajuste é uma linha nova");
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    assert.equal(total, 9500, "o saldo reflete a correção sem reescrever a história");
  });

  it("lote confirmado não retrocede de estado", async () => {
    const { batchId } = await createBatch(TENANT, "confirmed");

    await assert.rejects(
      () =>
        forTenant(
          TENANT,
          async (tx) =>
            tx.update(batches).set({ status: "proposed" }).where(eq(batches.id, batchId)),
          db,
        ),
      rejectsWith(/não retrocede/),
    );
  });

  it("o razão de um tenant é invisível para outro", async () => {
    await createBatch(TENANT);
    await createBatch(OTHER);

    const rows = await forTenant(OTHER, async (tx) => tx.select().from(transactions), db);

    assert.ok(rows.length > 0);
    assert.ok(
      rows.every((row) => row.tenantId === OTHER),
      "vazou transação de outro tenant",
    );
  });
});
