import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AnalysisResultSchema, CategorizationResultSchema } from "./agent-contracts";

describe("contratos estruturados dos subagentes", () => {
  it("analista não pode devolver número sem proveniência", () => {
    const result = AnalysisResultSchema.safeParse({
      kind: "metric",
      title: "Total",
      summary: "Leitura do período.",
      metric: { label: "Total", amount: 1000, transactionIds: [] },
      rows: [],
      warnings: [],
    });
    assert.equal(result.success, false);
  });

  it("proposta de categoria exige id, rótulo, motivo e transações", () => {
    const result = CategorizationResultSchema.safeParse({
      matchedRules: [],
      proposals: [
        {
          merchant: "Padaria",
          categoryId: "groceries",
          categoryLabel: "Mercado",
          reason: "Compra de alimentação.",
          transactionIds: ["txn_1"],
        },
      ],
      merchantAliases: [],
      warnings: [],
    });
    assert.equal(result.success, true);
  });
});
