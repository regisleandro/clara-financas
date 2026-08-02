import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { batchArtifact } from "./artifact";

describe("artefato de extrato", () => {
  it("mostra saldos e não trata o extrato como fatura", () => {
    const artifact = batchArtifact(
      {
        batchId: "bat_statement",
        documentKind: "bank_statement",
        issuer: "Nubank",
        invoiceLabel: "Nubank · Extrato 31/07/26",
        transactionCount: 2,
        checksum: {
          result: "no_declared_total",
          extractedTotal: 0,
          declaredTotal: null,
          difference: null,
          suspectItems: [],
        },
        statementBalance: {
          kind: "statement_balance",
          result: "match",
          openingBalance: 100_000,
          closingBalance: 75_000,
          netMovement: 25_000,
          expectedClosingBalance: 75_000,
          difference: 0,
        },
      },
      { onApprove: () => {}, onReject: () => {}, disabled: false, pendingGate: false },
    );

    assert.equal(artifact.title, "Nubank · Extrato 31/07/26");
    assert.equal(artifact.metricLabel, "Saldo final conferido");
    assert.equal(artifact.metric, "R$ 750,00");
    assert.equal(artifact.rows[0]?.label, "Saldo inicial");
    assert.equal(artifact.rows.some((row) => row.label.includes("fatura")), false);
  });
});
