import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import { createDbClient, type Database } from "./index";
import { loadTransactionsByIds } from "./queries/transactions";
import { documents, transactions } from "./schema/ledger";
import { forTenant } from "./tenant-scope";

/**
 * "De onde vem este número" — a leitura que fecha a promessa do produto.
 *
 * Os `transactionIds` sempre viajaram em cada linha de painel; o que faltava
 * era poder abri-los. Este teste trava as duas propriedades que importam: a
 * lista é a dos ids pedidos, e ela NÃO atravessa tenant — um id de outra
 * pessoa não vira linha na tela de ninguém.
 */

const TENANT_A = `tnt_prov_a_${randomUUID().slice(0, 8)}`;
const TENANT_B = `tnt_prov_b_${randomUUID().slice(0, 8)}`;

let db: Database;
let close: () => Promise<void>;
const ids: Record<string, string[]> = {};

async function seed(tenantId: string, count: number) {
  const documentId = `doc_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const created: string[] = [];

  await forTenant(
    tenantId,
    async (tx) => {
      await tx.insert(documents).values({
        id: documentId,
        tenantId,
        kind: "credit_card_invoice",
        blobKey: `${tenantId}/${documentId}.pdf`,
        filename: "fatura.pdf",
        issuer: "Nubank",
        contentHash: randomUUID().replace(/-/g, ""),
      });

      const batchId = `bat_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
      await tx.execute(sql`
        insert into batches (id, tenant_id, document_id, status)
        values (${batchId}, ${tenantId}, ${documentId}, 'proposed')
      `);

      for (let index = 0; index < count; index += 1) {
        const id = `txn_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
        created.push(id);
        await tx.insert(transactions).values({
          id,
          tenantId,
          batchId,
          sourceDocumentId: documentId,
          status: "confirmed",
          date: `2026-06-${String(index + 1).padStart(2, "0")}`,
          originalDescription: `COMPRA ${index + 1}`,
          merchant: `Loja ${index + 1}`,
          amount: 1_000 * (index + 1),
          kind: "purchase",
          extractionConfidence: "alta",
        });
      }
    },
    db,
  );

  return created;
}

describe("proveniência de um número", () => {
  before(async () => {
    const connection = createDbClient();
    db = connection.db;
    close = async () => {
      await connection.client.end({ timeout: 5 });
    };
    ids[TENANT_A] = await seed(TENANT_A, 3);
    ids[TENANT_B] = await seed(TENANT_B, 2);
  });

  after(async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await db.execute(sql`delete from transactions where tenant_id = ${tenantId}`);
      await db.execute(sql`delete from batches where tenant_id = ${tenantId}`);
      await db.execute(sql`delete from documents where tenant_id = ${tenantId}`);
    }
    await close();
  });

  it("devolve os lançamentos pedidos, com a descrição crua e a operadora", async () => {
    const entries = await loadTransactionsByIds(TENANT_A, ids[TENANT_A]!, db);

    assert.equal(entries.length, 3);
    assert.deepEqual(
      entries.map((entry) => entry.description),
      ["COMPRA 1", "COMPRA 2", "COMPRA 3"],
    );
    assert.ok(entries.every((entry) => entry.issuer === "Nubank"));
  });

  it("id de outro tenant não vira linha na tela de ninguém", async () => {
    const misturado = [...ids[TENANT_A]!, ...ids[TENANT_B]!];
    const entries = await loadTransactionsByIds(TENANT_A, misturado, db);

    assert.equal(entries.length, 3);
    assert.ok(entries.every((entry) => ids[TENANT_A]!.includes(entry.id)));
  });

  it("lançamento que saiu do razão simplesmente não volta", async () => {
    // É o caso do lote descartado: a tela precisa poder dizer "3 de 4 não
    // estão mais aqui" em vez de mostrar a lista curta como se fosse a conta.
    const entries = await loadTransactionsByIds(TENANT_A, [...ids[TENANT_A]!, "txn_inexistente"], db);

    assert.equal(entries.length, 3);
  });

  it("lista vazia não consulta nada", async () => {
    assert.deepEqual(await loadTransactionsByIds(TENANT_A, [], db), []);
  });

  it("o teto é de PÁGINA: o offset alcança o que passa do limite", async () => {
    /*
     * O teto era aplicado como limite do PEDIDO, e a rota recusava com 400
     * qualquer linha com mais de 100 lançamentos — a tela dizia "não consegui
     * abrir os lançamentos agora". A conferência falhava exatamente onde o
     * número era maior, que é onde alguém mais quer conferir.
     */
    const todos = ids[TENANT_A]!;
    const primeira = await loadTransactionsByIds(TENANT_A, todos, db, 0);
    const segunda = await loadTransactionsByIds(TENANT_A, todos, db, 2);

    assert.equal(primeira.length, 3);
    assert.equal(segunda.length, 1, "o offset pula o que já foi mostrado");
    assert.equal(segunda[0]?.id, primeira[2]?.id);
  });

  it("offset além do fim devolve vazio, não erro", async () => {
    assert.deepEqual(await loadTransactionsByIds(TENANT_A, ids[TENANT_A]!, db, 99), []);
  });
});
