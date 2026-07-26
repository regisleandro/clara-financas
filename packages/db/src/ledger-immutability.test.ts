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

  /**
   * A limpeza roda como DONO DO SCHEMA, não como aplicação.
   *
   * A versão anterior apagava só os rascunhos e deixava os confirmados para
   * trás, justificando que o trigger impede apagá-los — o que é verdade pelo
   * papel da aplicação, e é justamente a garantia sob teste. Mas a consequência
   * era que CADA execução da suíte deixava resíduo permanente no banco de
   * desenvolvimento, sem caminho de volta. Foram 8 documentos e 8 lotes por
   * rodada; três rodadas seguidas e o banco tinha 24 faturas fantasma que
   * ninguém tinha enviado.
   *
   * Desligar o trigger aqui não enfraquece nada: os testes acima já provaram,
   * pelo papel da aplicação, que confirmado não se apaga nem se altera. O dono
   * do schema sempre pôde fazer isso — é o mesmo poder que roda migração — e
   * usá-lo no teardown é o que separa "a garantia vale" de "o banco de dev vira
   * lixeira".
   */
  after(async () => {
    const admin = createDbClient(process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL);

    try {
      await admin.db.execute(sql`alter table transactions disable trigger user`);
      await admin.db.execute(sql`alter table batches disable trigger user`);
      try {
        for (const tenantId of [TENANT, OTHER]) {
          await admin.db.execute(sql`delete from transactions where tenant_id = ${tenantId}`);
          await admin.db.execute(sql`delete from batches where tenant_id = ${tenantId}`);
          await admin.db.execute(sql`delete from documents where tenant_id = ${tenantId}`);
        }
      } finally {
        // Reabilitar SEMPRE. Um trigger desligado por uma limpeza que falhou no
        // meio deixaria o razão editável, e o defeito só apareceria muito
        // depois, na forma mais cara possível: um número que mudou sozinho.
        await admin.db.execute(sql`alter table transactions enable trigger user`);
        await admin.db.execute(sql`alter table batches enable trigger user`);
      }
    } finally {
      await admin.client.end({ timeout: 5 });
      await close();
    }
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
      rejectsWith(/não podem ser alterados/),
      "o trigger deveria recusar a edição de valor em transação confirmada",
    );
  });

  it("categoria PODE mudar depois de confirmada — leitura não é fato", async () => {
    // A distinção que sustenta a hipótese H4: valor, data, descrição e origem
    // são fato e não mudam; categoria e comerciante são interpretação, e
    // interpretação muda quando a pessoa ensina algo ao sistema.
    const { transactionId } = await createBatch(TENANT, "confirmed");

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
    assert.equal(row?.status, "confirmed", "reclassificar não muda o estado do registro");
  });

  it("mudar data ou descrição continua barrado, mesmo junto de categoria", async () => {
    const { transactionId } = await createBatch(TENANT, "confirmed");

    await assert.rejects(
      () =>
        forTenant(
          TENANT,
          async (tx) =>
            tx
              .update(transactions)
              // Categoria é permitida; a data, não. A tentativa inteira cai.
              .set({ category: "dining", date: "2000-01-01" })
              .where(eq(transactions.id, transactionId)),
          db,
        ),
      rejectsWith(/não podem ser alterados/),
    );
  });

  it("atestar revisão humana é permitido e não altera nenhum número", async () => {
    // O atestado é uma terceira natureza, ao lado de FATO e LEITURA: registra
    // que alguém olhou. Precisa ser gravável numa linha já confirmada — é o que
    // tira o item da fila de revisão quando a conclusão é "a leitura já estava
    // certa" e nada muda.
    const { transactionId } = await createBatch(TENANT, "confirmed");

    const [before] = await forTenant(
      TENANT,
      async (tx) => tx.select().from(transactions).where(eq(transactions.id, transactionId)),
      db,
    );

    await forTenant(
      TENANT,
      async (tx) =>
        tx
          .update(transactions)
          .set({ reviewedAt: new Date(), reviewedBy: "human:usuario_1" })
          .where(eq(transactions.id, transactionId)),
      db,
    );

    const [after] = await forTenant(
      TENANT,
      async (tx) => tx.select().from(transactions).where(eq(transactions.id, transactionId)),
      db,
    );

    assert.equal(after?.reviewedBy, "human:usuario_1");
    assert.ok(after?.reviewedAt instanceof Date);
    assert.equal(after?.amount, before?.amount, "atestar não move dinheiro");
    assert.equal(after?.date, before?.date);
    assert.equal(after?.status, "confirmed");
  });

  it("o atestado não abre caminho para editar valor junto", async () => {
    const { transactionId } = await createBatch(TENANT, "confirmed");

    await assert.rejects(
      () =>
        forTenant(
          TENANT,
          async (tx) =>
            tx
              .update(transactions)
              .set({ reviewedAt: new Date(), amount: 1 })
              .where(eq(transactions.id, transactionId)),
          db,
        ),
      rejectsWith(/não podem ser alterados/),
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
