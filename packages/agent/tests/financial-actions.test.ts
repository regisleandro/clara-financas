import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  invoiceResolutionPlan,
  sameRevision,
} from "../agent/lib/financial-actions";

describe("workflow financeiro determinístico", () => {
  it("diferença negativa produz ajuste positivo", () => {
    assert.deepEqual(invoiceResolutionPlan(-353), {
      differenceBeforeCents: -353,
      adjustmentCents: 353,
      differenceAfterExpectedCents: 0,
    });
  });

  it("diferença positiva produz ajuste negativo", () => {
    assert.equal(invoiceResolutionPlan(500)?.adjustmentCents, -500);
  });

  it("não propõe ajuste para conferência já fechada ou valor inválido", () => {
    assert.equal(invoiceResolutionPlan(0), null);
    assert.equal(invoiceResolutionPlan(null), null);
    assert.equal(invoiceResolutionPlan(3.53), null);
  });

  it("uma revisão alterada invalida a proposta", () => {
    const prepared = new Date("2026-07-26T12:00:00.000Z");
    assert.equal(sameRevision(new Date(prepared), prepared), true);
    assert.equal(sameRevision(new Date("2026-07-26T12:00:00.001Z"), prepared), false);
  });
});
