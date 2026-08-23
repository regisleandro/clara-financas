import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OverviewResponse } from "@/lib/ledger-api";

import { ALL_ISSUERS, adaptOverview } from "./overview-model";

/**
 * `adaptOverview` só formata rótulo em português a partir do que o serviço
 * Python já calculou (`clara/tools/overview.py`) — as invariantes de soma
 * (categorias fecham o destaque, a curva termina em 100%, comparação bate)
 * são testadas lá, contra Postgres real, não aqui com dados forjados.
 */
function response(overrides: Partial<OverviewResponse> = {}): OverviewResponse {
  return {
    months: ["2026-07", "2026-06"],
    issuers: [
      { key: "nubank", label: "Nubank" },
      { key: "itau", label: "Itaú" },
    ],
    selectedMonth: "2026-07",
    selectedIssuer: ALL_ISSUERS,
    total: 20_000,
    credits: 0,
    net: 20_000,
    comparison: { previousMonth: "2026-06", previousTotal: 15_000, delta: 5_000, deltaPercent: 33.3 },
    spark: [50, 100],
    range: { from: "2026-07-01", to: "2026-07-15" },
    categories: [{ category: "dining", label: "Restaurantes", value: 20_000, share: 1, count: 2 }],
    insight: null,
    ...overrides,
  };
}

describe("adaptOverview", () => {
  it("formata o mês selecionado por extenso, em português", () => {
    const overview = adaptOverview(response());

    assert.equal(overview.periodLabel, "Julho de 2026");
  });

  it("resolve o rótulo da origem a partir da chave selecionada", () => {
    const overview = adaptOverview(response({ selectedIssuer: "nubank" }));

    assert.equal(overview.originLabel, "Nubank");
  });

  it("usa 'Todas as origens' quando nenhuma foi escolhida", () => {
    const overview = adaptOverview(response({ selectedIssuer: ALL_ISSUERS }));

    assert.equal(overview.originLabel, "Todas as origens");
  });

  it("repassa os números sem alterar nenhum", () => {
    const overview = adaptOverview(response());

    assert.equal(overview.total, 20_000);
    assert.equal(overview.comparison?.delta, 5_000);
    assert.equal(overview.comparison?.previousTotal, 15_000);
    assert.deepEqual(
      overview.categories.map((category) => category.value),
      [20_000],
    );
  });

  it("monta a legenda do período anterior em minúsculas", () => {
    const overview = adaptOverview(response());

    assert.equal(overview.comparison?.previousLabel, "junho de 2026");
  });

  it("sem mês selecionado, devolve o painel vazio sem quebrar", () => {
    const overview = adaptOverview(response({ selectedMonth: null, comparison: null, range: null }));

    assert.equal(overview.selectedMonth, null);
    assert.equal(overview.total, 0);
    assert.deepEqual(overview.rangeLabels, { from: "", to: "" });
  });

  it("monta o texto do insight a partir da categoria e da variação", () => {
    const overview = adaptOverview(
      response({ insight: { category: "dining", label: "restaurantes", deltaRatio: 0.62 } }),
    );

    assert.equal(overview.insight?.headline, "Restaurantes subiu 62%. É o que mais explica o mês.");
    assert.equal(overview.insight?.href, "/conversa");
  });

  it("sem insight, não inventa um", () => {
    const overview = adaptOverview(response({ insight: null }));

    assert.equal(overview.insight, null);
  });
});
