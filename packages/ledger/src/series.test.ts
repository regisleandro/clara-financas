import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeFinancialSeries } from "./series";
import type { Transaction } from "./types";

const tx = (id: string, amount: number, category: string): Transaction => ({
  id,
  date: "2026-06-01",
  originalDescription: id,
  merchant: id,
  merchantKey: id,
  amount,
  kind: "purchase",
  installment: null,
  category,
  extractionConfidence: "alta",
  sourceDocument: "doc_test",
  page: 1,
});

describe("analyzeFinancialSeries", () => {
  it("calcula todos os pontos e drivers entre o primeiro e o último período", () => {
    const result = analyzeFinancialSeries([
      { id: "a", label: "Maio", transactions: [tx("mercado-a", 100, "groceries")] },
      { id: "b", label: "Junho", transactions: [tx("mercado-b", 140, "groceries")] },
      { id: "c", label: "Julho", transactions: [tx("restaurante-c", 180, "dining")] },
    ]);

    assert.deepEqual(result.points.map((point) => point.value), [100, 140, 180]);
    assert.equal(result.totalDelta, 80);
    assert.equal(result.largest?.id, "c");
    assert.equal(result.smallest?.id, "a");
    assert.equal(result.drivers[0]?.category, "dining");
    assert.deepEqual(result.drivers[0]?.transactionIds, ["restaurante-c"]);
  });

  it("não conta pagamento de fatura como gasto", () => {
    const payment = { ...tx("payment", 500, "payments"), kind: "payment" as const };
    const result = analyzeFinancialSeries([
      { id: "a", label: "Maio", transactions: [payment] },
      { id: "b", label: "Junho", transactions: [payment] },
    ]);
    assert.deepEqual(result.points.map((point) => point.value), [0, 0]);
    assert.equal(result.totalDelta, 0);
  });
});
