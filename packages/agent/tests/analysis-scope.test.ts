import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalAnalysisRequestScope,
  canonicalAnalysisScope,
} from "../agent/lib/analysis-scope";

describe("escopo canônico de análise", () => {
  it("converte um mês civil completo em calendar_month", () => {
    assert.deepEqual(
      canonicalAnalysisScope({ kind: "range", from: "2099-01-01", to: "2099-01-31" }),
      { kind: "calendar_month", month: "2099-01" },
    );
  });

  it("respeita fevereiro bissexto e preserva o emissor", () => {
    assert.deepEqual(
      canonicalAnalysisScope({
        kind: "range",
        from: "2028-02-01",
        to: "2028-02-29",
        issuer: "Nubank",
      }),
      { kind: "calendar_month", month: "2028-02", issuer: "Nubank" },
    );
  });

  it("não muda intervalos parciais", () => {
    const scope = { kind: "range", from: "2099-01-02", to: "2099-01-31" } as const;
    assert.equal(canonicalAnalysisScope(scope), scope);
  });

  it("normaliza os dois lados de uma comparação", () => {
    assert.deepEqual(
      canonicalAnalysisRequestScope({
        kind: "comparison",
        current: { kind: "range", from: "2028-02-01", to: "2028-02-29" },
        previous: { kind: "range", from: "2028-01-01", to: "2028-01-31" },
      }),
      {
        kind: "comparison",
        current: { kind: "calendar_month", month: "2028-02" },
        previous: { kind: "calendar_month", month: "2028-01" },
      },
    );
  });
});
