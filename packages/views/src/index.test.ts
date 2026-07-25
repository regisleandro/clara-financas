import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseView, viewTransactionIds, ViewSchema } from "./index";

/**
 * O painel é montado por um modelo, então o schema é a fronteira entre "a
 * Clara escolheu uma forma" e "a conversa quebrou num erro de render". Estes
 * testes cobrem o que um modelo erra de verdade: campo faltando, kind
 * inventado, dinheiro em reais em vez de centavos, e proveniência esquecida.
 */

describe("parseView", () => {
  it("aceita um painel de métrica completo", () => {
    const view = parseView({
      kind: "metric",
      title: "Restaurantes em junho",
      metric: { label: "Total", amount: 84210 },
      rows: [{ label: "Outback", amount: 21000, transactionIds: ["t1"] }],
    });

    assert.equal(view?.kind, "metric");
    assert.equal(view?.rows[0]?.label, "Outback");
  });

  it("recusa kind inventado em vez de renderizar lixo", () => {
    assert.equal(parseView({ kind: "pizza", title: "x" }), null);
  });

  it("recusa valor fracionado — dinheiro é centavo inteiro", () => {
    const view = parseView({
      kind: "metric",
      title: "Total",
      metric: { label: "Total", amount: 84.21 },
    });
    assert.equal(view, null);
  });

  it("recusa breakdown sem linha alguma", () => {
    assert.equal(parseView({ kind: "breakdown", title: "Composição", rows: [] }), null);
  });

  it("recusa share fora de 0..1, que quebraria a barra", () => {
    const view = parseView({
      kind: "breakdown",
      title: "Composição",
      rows: [{ label: "Mercado", share: 1.4, transactionIds: [] }],
    });
    assert.equal(view, null);
  });

  it("proveniência ausente vira lista vazia, não undefined", () => {
    const view = parseView({
      kind: "breakdown",
      title: "Composição",
      rows: [{ label: "Mercado", amount: 1000 }],
    });
    assert.deepEqual(view?.rows[0]?.transactionIds, []);
  });

  it("comparação exige os rótulos dos dois períodos", () => {
    const missing = parseView({
      kind: "comparison",
      title: "Maio contra junho",
      currentLabel: "Junho",
      rows: [{ label: "Restaurantes", transactionIds: [] }],
    });
    assert.equal(missing, null);
  });

  it("conferência carrega os três totais e o resultado", () => {
    const view = parseView({
      kind: "checksum",
      title: "Conferência da fatura",
      declaredTotal: 325162,
      extractedTotal: 325161,
      difference: -1,
      result: "mismatch",
      cause: "arredondamento de IOF",
    });

    assert.equal(view?.kind, "checksum");
    // A diferença é assinada de propósito: para menos e para mais são erros
    // diferentes, e o valor absoluto esconderia qual dos dois aconteceu.
    assert.equal(view?.kind === "checksum" ? view.difference : null, -1);
  });

  it("título vazio não passa — painel sem título não se lê", () => {
    assert.equal(parseView({ kind: "metric", title: "", metric: { label: "x" } }), null);
  });

  it("limita o tamanho da lista, senão o painel vira despejo de dados", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      label: `Item ${i}`,
      transactionIds: [],
    }));
    assert.equal(parseView({ kind: "transactions", title: "Razão", rows }), null);
  });
});

describe("viewTransactionIds", () => {
  it("reúne a proveniência de todas as linhas, sem repetir", () => {
    const view = ViewSchema.parse({
      kind: "breakdown",
      title: "Composição",
      rows: [
        { label: "Mercado", transactionIds: ["t1", "t2"] },
        { label: "Restaurantes", transactionIds: ["t2", "t3"] },
      ],
    });

    assert.deepEqual(viewTransactionIds(view).sort(), ["t1", "t2", "t3"]);
  });
});
