import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { verifyStatementBalance } from "./statement";
import type { Transaction } from "./types";

const movement = (id: string, amount: number, kind: Transaction["kind"] = "purchase"): Transaction => ({
  id,
  date: "2026-06-01",
  originalDescription: id,
  merchant: id,
  merchantKey: id,
  amount,
  kind,
  installment: null,
  category: null,
  extractionConfidence: "alta",
  sourceDocument: "doc_statement",
  page: 1,
});

describe("verifyStatementBalance", () => {
  it("fecha saldo inicial menos saídas e entradas", () => {
    const report = verifyStatementBalance(
      [movement("compra", 250), movement("salario", -1_000, "income")],
      10_000,
      10_750,
    );
    assert.equal(report.result, "match");
    assert.equal(report.netMovement, -750);
    assert.equal(report.expectedClosingBalance, 10_750);
    assert.equal(report.difference, 0);
  });

  it("não inventa conferência quando um saldo não veio do documento", () => {
    const report = verifyStatementBalance([movement("compra", 250)], null, 9_750);
    assert.equal(report.result, "insufficient_data");
    assert.equal(report.expectedClosingBalance, null);
    assert.equal(report.difference, null);
  });
});
