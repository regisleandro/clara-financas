import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TransactionSchema, type CategoryLabels } from "@clara-financas/ledger";

import { ALL_ISSUERS, buildOverview, type OverviewRow } from "./overview-model";

const labels: CategoryLabels = { dining: "Restaurantes", groceries: "Mercado" };
let sequence = 0;

function row(
  date: string,
  amount: number,
  issuer: string | null,
  category = "dining",
): OverviewRow {
  sequence += 1;
  return {
    ...TransactionSchema.parse({
      id: `overview-${sequence}`,
      date,
      originalDescription: "Compra",
      amount,
      category,
      extractionConfidence: "alta",
      sourceDocument: `doc-${sequence}`,
    }),
    documentIssuer: issuer,
  };
}

const rows = [
  row("2026-06-10", 10_000, "Nubank"),
  row("2026-06-12", 5_000, "Itaú", "groceries"),
  row("2026-07-10", 13_000, "Nubank"),
  row("2026-07-15", 7_000, "Itaú", "groceries"),
];

describe("buildOverview", () => {
  it("abre no mês mais recente e reúne todas as origens", () => {
    const overview = buildOverview(rows, labels);

    assert.equal(overview.selectedMonth, "2026-07");
    assert.equal(overview.selectedIssuer, ALL_ISSUERS);
    assert.equal(overview.total, 20_000);
    assert.equal(overview.comparison?.previousTotal, 15_000);
    assert.equal(overview.comparison?.delta, 5_000);
  });

  it("filtra mês e origem no total, categorias e comparação", () => {
    const overview = buildOverview(rows, labels, {
      month: "2026-07",
      issuer: "nubank",
    });

    assert.equal(overview.originLabel, "Nubank");
    assert.equal(overview.total, 13_000);
    assert.equal(overview.comparison?.previousTotal, 10_000);
    assert.equal(overview.comparison?.delta, 3_000);
    assert.deepEqual(overview.categories.map((item) => item.label), ["Restaurantes"]);
  });

  it("aceita navegar para um mês anterior", () => {
    const overview = buildOverview(rows, labels, { month: "2026-06" });

    assert.equal(overview.selectedMonth, "2026-06");
    assert.equal(overview.total, 15_000);
    assert.equal(overview.comparison, null);
  });

  it("não usa filtros inexistentes para trazer uma fatura aleatória", () => {
    const overview = buildOverview(rows, labels, {
      month: "2024-01",
      issuer: "banco-desconhecido",
    });

    assert.equal(overview.selectedMonth, "2026-07");
    assert.equal(overview.selectedIssuer, ALL_ISSUERS);
    assert.equal(overview.total, 20_000);
  });
});
