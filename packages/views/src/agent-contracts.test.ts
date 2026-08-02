import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AnalysisArtifactSchema,
  AnalysisReceiptSchema,
  AnalysisResultSchema,
  AnalysisScopeSchema,
  CategorizationResultSchema,
} from "./agent-contracts";

describe("contratos estruturados dos subagentes", () => {
  it("escopo rejeita mês impossível e intervalo invertido", () => {
    assert.equal(
      AnalysisScopeSchema.safeParse({ kind: "calendar_month", month: "2026-13" }).success,
      false,
    );
    assert.equal(
      AnalysisScopeSchema.safeParse({ kind: "range", from: "2026-08-02", to: "2026-08-01" })
        .success,
      false,
    );
  });

  it("recibo analítico não permite números financeiros", () => {
    const result = AnalysisReceiptSchema.parse({
      artifactId: "art_abc123",
      artifactKind: "analysis",
      nextAction: "present_analysis",
      viewKind: "metric",
      warnings: [],
      amount: 1000,
    });
    assert.equal("amount" in result, false);
  });

  it("artefato recusa troca silenciosa do escopo", () => {
    const result = AnalysisArtifactSchema.safeParse({
      artifactKind: "analysis",
      requestedScope: { kind: "calendar_month", month: "2026-08" },
      actualScope: { kind: "calendar_month", month: "2026-06" },
      view: {
        kind: "metric",
        title: "Gastos",
        metric: { label: "Resultado", text: "Sem lançamentos" },
        rows: [],
      },
      warnings: [],
    });
    assert.equal(result.success, false);
  });

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

  /**
   * Os três casos que faltavam — e cuja ausência produziu, em produção, a
   * resposta "a consulta não retornou a estrutura necessária". Toda resposta
   * CERTA para uma fatura que não fecha era inválida pelo schema.
   */
  it("analista pode devolver a conferência de uma fatura", () => {
    const result = AnalysisResultSchema.safeParse({
      kind: "checksum",
      title: "Conferência da fatura",
      summary: "A soma dos lançamentos ficou 3 centavos acima do total declarado.",
      checksum: {
        batchId: "bat_1",
        declaredTotal: 438_792,
        extractedTotal: 438_795,
        difference: 3,
        result: "mismatch",
        cause: "Compatível com arredondamento do IOF.",
      },
      rows: [
        { label: "Total declarado", amount: 438_792 },
        { label: "Diferença", amount: 3, detail: "Não há item culpado." },
      ],
      warnings: [],
    });
    assert.equal(result.success, true);
  });

  it("conferência sem o objeto checksum é recusada", () => {
    const result = AnalysisResultSchema.safeParse({
      kind: "checksum",
      title: "Conferência",
      summary: "Falta o que sustenta a afirmação.",
      rows: [],
      warnings: [],
    });
    assert.equal(result.success, false);
  });

  it('"não encontrei nada neste recorte" é uma resposta válida', () => {
    const result = AnalysisResultSchema.safeParse({
      kind: "transactions",
      title: "Nada neste recorte",
      summary: "Não há lançamentos entre 01/07 e 31/07; o razão cobre 31/05 a 30/06.",
      warnings: [],
      ledgerCoverage: { count: 48, firstDate: "2026-05-31", lastDate: "2026-06-30" },
    });
    assert.equal(result.success, true);
    // `rows` era obrigatório: o modelo não tinha como dizer "vazio".
    assert.deepEqual(result.data?.rows, []);
  });
});
