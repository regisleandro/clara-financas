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

describe("paridade com o painel da conversa", () => {
  /*
   * "Mesma pergunta, duas telas, dois números."
   *
   * O destaque desta tela era o gasto LÍQUIDO (estornos abatidos) enquanto o
   * painel da conversa passou a mostrar COMPRAS. Perguntar "quanto gastei em
   * junho" na conversa e olhar `/inicio` dava valores diferentes, ambos
   * corretos pela sua própria definição e nenhum dos dois explicando o outro.
   *
   * A escala agora é a mesma nos dois lugares, e o que o líquido tinha de
   * informação vai nomeado ao lado.
   */
  const comEstorno = [
    row("2026-06-10", 10_000, "Nubank"),
    row("2026-06-11", -2_000, "Nubank"),
    row("2026-06-12", 5_000, "Itaú", "groceries"),
  ];

  it("o destaque são as compras, com créditos e líquido nomeados", () => {
    const overview = buildOverview(comEstorno, labels, { month: "2026-06", issuer: ALL_ISSUERS });

    assert.equal(overview.total, 15_000, "compras, como o painel");
    assert.equal(overview.credits, -2_000);
    assert.equal(overview.net, 13_000);
    assert.equal(overview.total + overview.credits, overview.net);
  });

  it("as categorias somam o destaque", () => {
    // A mesma invariante que o painel: somar a coluna tem de dar o número
    // grande em cima dela.
    const overview = buildOverview(comEstorno, labels, { month: "2026-06", issuer: ALL_ISSUERS });
    const soma = overview.categories.reduce((total, category) => total + category.value, 0);

    assert.equal(soma, overview.total);
  });

  it("a curva acumula a mesma coisa que o destaque", () => {
    // A sparkline já acumulava só positivos sob um total líquido: a curva
    // terminava em 100% de um número que não era o exibido.
    const overview = buildOverview(comEstorno, labels, { month: "2026-06", issuer: ALL_ISSUERS });

    assert.equal(overview.spark.at(-1), 100);
    assert.equal(overview.total, 15_000, "e o 100% da curva é este total");
  });
});
