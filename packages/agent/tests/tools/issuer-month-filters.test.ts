import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import aggregateByCategory from "../../agent/subagents/analyst/tools/aggregate_by_category";
import queryLedger from "../../agent/subagents/analyst/tools/query_ledger";
import commitBatch from "../../agent/tools/commit_batch";
import proposeBatch from "../../agent/tools/propose_batch";
import { loadSnapshot } from "../../agent/lib/snapshot";
import {
  closeConnections,
  ctxFor,
  dropTenant,
  freshTenant,
  seedDocument,
  viewFromReceipt,
} from "../helpers/harness";

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
    const receipt = await queryLedger.execute(
      { scope: { kind: "all", issuer: "NUBANK" } },
      ctx,
    );
    const result = (await viewFromReceipt(receipt, ctx)) as {
      rows: Array<{ label: string }>;
    };

    assert.equal(result.rows.length, 2);
    assert.ok(result.rows.every((row) => row.label === "Loja Nubank"));
  });

  it("operadora sem documento devolve vazio, nunca o razão inteiro", async () => {
    const receipt = await queryLedger.execute(
      { scope: { kind: "all", issuer: "Bradesco" } },
      ctx,
    );
    const result = (await viewFromReceipt(receipt, ctx)) as {
      metric: { text?: string };
    };
    assert.equal(result.metric.text, "Sem lançamentos");
  });

  it("month é o mês inteiro, com o último dia certo", async () => {
    const june = (await viewFromReceipt(
      await queryLedger.execute({ scope: { kind: "calendar_month", month: "2026-06" } }, ctx),
      ctx,
    )) as { rows: unknown[] };
    assert.equal(june.rows.length, 2);

    const july = (await viewFromReceipt(
      await queryLedger.execute({ scope: { kind: "calendar_month", month: "2026-07" } }, ctx),
      ctx,
    )) as { rows: unknown[] };
    assert.equal(july.rows.length, 1);
  });

  it("aggregate_by_category cruza operadora e mês", async () => {
    const receipt = await aggregateByCategory.execute(
      { scope: { kind: "calendar_month", month: "2026-06", issuer: "Nubank" } },
      ctx,
    );
    const result = (await viewFromReceipt(receipt, ctx)) as {
      metric: { amount: number; detail: string };
    };

    assert.equal(result.metric.amount, 5_000);
    assert.match(result.metric.detail, /2026-06.*Nubank/);
  });

  it("o snapshot lista as operadoras conhecidas", async () => {
    const snapshot = await loadSnapshot(tenantId);
    assert.deepEqual(snapshot.issuers, ["Itaú", "Nubank"]);
  });
});
