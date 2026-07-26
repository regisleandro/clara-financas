import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import aggregateByCategory from "../../agent/subagents/analyst/tools/aggregate_by_category";
import queryLedger from "../../agent/subagents/analyst/tools/query_ledger";
import commitBatch from "../../agent/tools/commit_batch";
import proposeBatch from "../../agent/tools/propose_batch";
import { loadSnapshot } from "../../agent/lib/snapshot";
import { closeConnections, ctxFor, dropTenant, freshTenant, seedDocument } from "../helpers/harness";

/**
 * "Quanto gastei no Nubank em junho" — a pergunta que era irrespondível.
 *
 * Nenhuma tool aceitava operadora como filtro, e mês exigia o modelo calcular
 * o último dia na cabeça. O recorte por operadora usa `issuerKey`, a MESMA
 * chave da visão por operadora da web: grafias diferentes da mesma operadora
 * casam, e uma operadora sem documento devolve vazio — nunca o razão inteiro.
 */

let tenantId: string;
let ctx: never;

async function seedInvoice(issuer: string, date: string, amountCents: number) {
  const documentId = await seedDocument(tenantId, {
    filename: `${issuer.toLowerCase()}-${date}.pdf`,
    issuer,
  });
  const proposed = (await proposeBatch.execute(
    {
      documentId,
      declaredTotal: amountCents,
      transactions: [
        {
          date,
          originalDescription: `COMPRA ${issuer.toUpperCase()} ${date}`,
          merchant: `Loja ${issuer}`,
          amount: amountCents,
          category: "groceries",
          extractionConfidence: "alta",
        },
      ],
    },
    ctx,
  )) as { batchId: string };
  await commitBatch.execute({ batchId: proposed.batchId }, ctx);
}

describe("filtro por operadora e por mês", () => {
  before(async () => {
    tenantId = await freshTenant();
    ctx = ctxFor(tenantId);
    await seedInvoice("Nubank", "2026-06-10", 5_000);
    await seedInvoice("Itaú", "2026-06-12", 3_000);
    await seedInvoice("Nubank", "2026-07-02", 2_000);
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  it("query_ledger recorta por operadora, sem exigir acento nem caixa", async () => {
    // "NUBANK" ≠ "Nubank" letra a letra; a chave de identidade iguala os dois.
    const result = (await queryLedger.execute({ issuer: "NUBANK" }, ctx)) as {
      matched: number;
      transactions: Array<{ merchant: string | null }>;
    };

    assert.equal(result.matched, 2);
    assert.ok(result.transactions.every((row) => row.merchant === "Loja Nubank"));
  });

  it("operadora sem documento devolve vazio, nunca o razão inteiro", async () => {
    const result = (await queryLedger.execute({ issuer: "Bradesco" }, ctx)) as {
      empty?: boolean;
      matched?: number;
    };
    assert.equal(result.empty, true);
  });

  it("month é o mês inteiro, com o último dia certo", async () => {
    const june = (await queryLedger.execute({ month: "2026-06" }, ctx)) as { matched: number };
    assert.equal(june.matched, 2);

    const july = (await queryLedger.execute({ month: "2026-07" }, ctx)) as { matched: number };
    assert.equal(july.matched, 1);
  });

  it("aggregate_by_category cruza operadora e mês", async () => {
    const result = (await aggregateByCategory.execute(
      { issuer: "Nubank", month: "2026-06" },
      ctx,
    )) as {
      total: { cents: number };
      period: { issuer: string | null; from: string | null; to: string | null };
    };

    assert.equal(result.total.cents, 5_000);
    // O recorte usado volta na resposta: "R$ 50,00" sem dizer de onde não
    // seria conferível.
    assert.equal(result.period.issuer, "Nubank");
    assert.equal(result.period.from, "2026-06-01");
    assert.equal(result.period.to, "2026-06-30");
  });

  it("o snapshot lista as operadoras conhecidas", async () => {
    const snapshot = await loadSnapshot(tenantId);
    assert.deepEqual(snapshot.issuers, ["Itaú", "Nubank"]);
  });
});
