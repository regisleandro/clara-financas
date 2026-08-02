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

/** Como `tx`, mas com data — a ordem cronológica depende dela. */
const seriesTx = (partial: { id: string; date: string; amount: number }): Transaction => ({
  ...tx(partial.id, partial.amount, "groceries"),
  date: partial.date,
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

describe("a ordem vem dos dados, não da entrada", () => {
  /*
   * `totalDelta` é "último menos primeiro" e os drivers comparam a primeira
   * fatura com a última. Enquanto isso seguia a ordem de ENTRADA, um modelo que
   * listasse do mais recente para o mais antigo — que é como uma pessoa fala,
   * "as três últimas faturas" — invertia o sinal da variação. O `InputSchema`
   * só validava ids únicos, então nada denunciava.
   */
  const maio = {
    id: "maio",
    label: "Maio",
    transactions: [seriesTx({ id: "m1", date: "2026-05-10", amount: 10_000 })],
  };
  const junho = {
    id: "junho",
    label: "Junho",
    transactions: [seriesTx({ id: "j1", date: "2026-06-10", amount: 15_000 })],
  };

  it("períodos invertidos produzem a MESMA série que na ordem certa", () => {
    const naOrdem = analyzeFinancialSeries([maio, junho]);
    const aoContrario = analyzeFinancialSeries([junho, maio]);

    assert.equal(naOrdem.totalDelta, 5_000, "de 10.000 para 15.000: subiu");
    assert.equal(aoContrario.totalDelta, naOrdem.totalDelta, "o sinal não depende da ordem de entrada");
    assert.deepEqual(
      aoContrario.points.map((point) => point.id),
      naOrdem.points.map((point) => point.id),
    );
  });

  it("os drivers explicam a mudança no sentido certo, em qualquer ordem", () => {
    const aoContrario = analyzeFinancialSeries([junho, maio]);

    assert.ok((aoContrario.drivers[0]?.delta ?? 0) > 0, "a categoria que subiu aparece como aumento");
  });

  it("período sem lançamento não vira a base da comparação", () => {
    // Comparar contra o vazio faria "subiu tudo" a partir de zero.
    const vazio = { id: "vazio", label: "Sem dados", transactions: [] };
    const series = analyzeFinancialSeries([vazio, maio, junho]);

    assert.equal(series.points.at(-1)?.id, "vazio", "o sem-âncora vai para o fim");
    assert.equal(series.points[0]?.id, "maio");
  });
});
