import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AnalysisArtifactSchema,
  AnalysisReceiptSchema,
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
      artifactIds: ["art_abc123"],
      artifactKind: "analysis",
      nextAction: "present_analysis",
      viewKinds: ["metric"],
      warnings: [],
      amount: 1000,
    });
    assert.equal("amount" in result, false);
  });

  it("o recibo carrega VÁRIOS painéis — era o que o prompt já mandava", () => {
    /*
     * As instruções mandavam o coordenador passar "a lista completa de
     * `artifactIds`" e o analista devolver "uma entrega que referencie todos
     * eles". `artifactIds` não existia em schema nenhum: o modelo obedecia, a
     * validação reprovava a forma, e o turno morria SEM NENHUMA TOOL TER
     * FALHADO — o cenário mais difícil de diagnosticar que existe aqui.
     *
     * Que o plural era a intenção dá para provar pelo frontend, que já era
     * `views: View[]` com um comentário dizendo que a Clara pode desenhar mais
     * de um painel na mesma resposta.
     */
    const result = AnalysisReceiptSchema.parse({
      artifactIds: ["art_abc123", "art_def456"],
      artifactKind: "analysis",
      nextAction: "present_analysis",
      viewKinds: ["breakdown", "comparison"],
      warnings: [],
    });

    assert.equal(result.artifactIds.length, 2);
    assert.deepEqual(result.viewKinds, ["breakdown", "comparison"]);
  });

  it("recibo sem nenhum artefato é recusado", () => {
    // "Apresente" sem nada para apresentar não é uma resposta possível.
    assert.equal(
      AnalysisReceiptSchema.safeParse({
        artifactIds: [],
        artifactKind: "analysis",
        nextAction: "present_analysis",
        viewKinds: [],
        warnings: [],
      }).success,
      false,
    );
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

  it("proposta de categoria exige id, rótulo, motivo e transações", () => {
    const result = CategorizationResultSchema.safeParse({
      matchedRules: [],
      proposals: [
        {
          merchant: "Padaria",
          categoryId: "groceries",
          categoryLabel: "Mercado",
          reason: "Compra de alimentação.",
          count: 1,
          totalCents: 3_997,
          transactionIds: ["txn_1"],
        },
      ],
      merchantAliases: [],
      warnings: [],
    });
    assert.equal(result.success, true);
  });

});
