import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseView, parseViewResult, viewTransactionIds, ViewSchema } from "./index";

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
      metric: { label: "Total", amount: 84210, transactionIds: ["t1"] },
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

  it("recusa uma linha financeira sem proveniência", () => {
    const view = parseView({
      kind: "breakdown",
      title: "Composição",
      rows: [{ label: "Mercado", amount: 1000 }],
    });
    assert.equal(view, null);
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
      batchId: "bat_1",
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

  it("conferência aceita fatura sem total declarado", () => {
    // O domínio permite `declaredTotal: null` (ChecksumReport). Exigir número
    // aqui forçava o modelo a inventar 0 — "Total da fatura R$ 0,00" na tela —
    // ou a mandar null e perder o painel inteiro.
    const view = parseView({
      kind: "checksum",
      batchId: "bat_1",
      title: "Conferência da fatura",
      declaredTotal: null,
      extractedTotal: 325161,
      difference: null,
      result: "no_declared_total",
    });

    assert.equal(view?.kind, "checksum");
    assert.equal(view?.kind === "checksum" ? view.declaredTotal : 0, null);
  });

  it("conferência continua recusando centavo fracionado", () => {
    const view = parseView({
      kind: "checksum",
      batchId: "bat_1",
      title: "Conferência",
      declaredTotal: 3251.62,
      extractedTotal: 325161,
      difference: -1,
      result: "mismatch",
    });
    assert.equal(view, null);
  });

  it("agenda desenha vencimentos sem proveniência — não há transação por trás", () => {
    // Um compromisso é um lembrete agendado, não um lançamento do razão.
    // Exigir `transactionIds` aqui reprovaria TODO painel de vencimentos, e o
    // sintoma seria a pessoa perguntar o que vence e não receber painel algum.
    const view = parseView({
      kind: "commitments",
      title: "Próximos vencimentos",
      metric: { label: "A pagar em 30 dias", amount: 412300 },
      rows: [
        { label: "Fatura Nubank", amount: 325162, detail: "vence em 3 dias · 12/08", accent: "danger" },
        { label: "Aluguel", amount: 87138, detail: "vence em 21 dias · 30/08", accent: "attention" },
      ],
    });

    assert.equal(view?.kind, "commitments");
    assert.equal(view?.rows[0]?.accent, "danger");
  });

  it("proposta exige proveniência — decidir sobre lista sem ids é decidir no escuro", () => {
    const view = parseView({
      kind: "proposal",
      title: "Categorias sugeridas",
      rows: [{ label: "Nuvem Digital", detail: "Sem categoria → Assinaturas" }],
    });
    assert.equal(view, null);
  });

  it("proposta passa quando cada linha diz a quais lançamentos se aplica", () => {
    const view = parseView({
      kind: "proposal",
      title: "Categorias sugeridas",
      summary: "Três lançamentos sem categoria que parecem assinaturas.",
      rows: [
        {
          label: "Nuvem Digital",
          detail: "Sem categoria → Assinaturas",
          transactionIds: ["t1", "t2", "t3"],
        },
      ],
    });

    assert.equal(view?.kind, "proposal");
    assert.deepEqual(view === null ? [] : viewTransactionIds(view), ["t1", "t2", "t3"]);
  });

  it("recusa accent inventado — o marcador tem vocabulário fechado", () => {
    const view = parseView({
      kind: "commitments",
      title: "Vencimentos",
      rows: [{ label: "Fatura", accent: "urgentissimo" }],
    });
    assert.equal(view, null);
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

describe("parseViewResult", () => {
  it("descreve POR QUE o payload falhou, para log e telemetria", () => {
    // "Não virou painel" sem rastro era indepurável: o sintoma em produção
    // era só "o artefato às vezes não abre".
    const result = parseViewResult({
      kind: "metric",
      title: "Total",
      metric: { label: "Total", amount: 84.21 },
    });

    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.issues.some((issue) => issue.includes("metric.amount")));
  });

  it("payload válido devolve o painel tipado", () => {
    const result = parseViewResult({
      kind: "metric",
      title: "Total",
      metric: { label: "Total", amount: 8421, transactionIds: ["t1"] },
    });
    assert.ok(result.ok);
  });

  it("recusa checksum aritmeticamente contraditório", () => {
    const result = parseViewResult({
      kind: "checksum",
      title: "Conferência",
      batchId: "bat_1",
      declaredTotal: 84_392,
      extractedTotal: 0,
      difference: 0,
      result: "match",
      rows: [],
    });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.issues.some((issue) => issue.includes("difference")));
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
