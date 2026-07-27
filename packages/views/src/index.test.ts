import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkView,
  DEFAULT_BASIS,
  formatViewIssues,
  parseView,
  parseViewResult,
  VIEW_KINDS,
  viewTransactionIds,
  ViewSchema,
} from "./index";

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

  it("recusa centavos crus no texto de uma métrica financeira", () => {
    const view = parseView({
      kind: "metric",
      title: "Total da fatura",
      metric: { label: "Total", text: "5000000" },
    });
    assert.equal(view, null);
  });

  it("aceita contagem inteira no texto de uma métrica não financeira", () => {
    const view = parseView({
      kind: "metric",
      title: "Assinaturas",
      metric: { label: "Assinaturas", text: "6" },
    });
    assert.equal(view?.kind, "metric");
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

  /**
   * "Liste as faturas mês a mês" — o pedido que não tinha resposta possível.
   *
   * O total de uma fatura é fato do DOCUMENTO: é o que ele declara, ou a soma
   * que a extração leu dele. Não existe conjunto de lançamentos que a
   * coordenadora escolheu somar, então não há id para exigir. Enquanto não havia
   * esta forma, as quatro que aceitariam a lista reprovavam na proveniência e a
   * única que passaria era `commitments` — que desenha "Agenda" sobre um
   * histórico de faturas. Entre um painel reprovado e a proibição de despejar
   * números no chat, a pessoa não recebia nada.
   */
  it("histórico de faturas desenha sem proveniência — o total é fato do documento", () => {
    const view = parseView({
      kind: "invoices",
      title: "Faturas mês a mês",
      summary: "Três ciclos registrados, do mais antigo para o mais recente.",
      rows: [
        { label: "Nubank 07/05/26", amount: 391_040, detail: "ciclo 31/03–30/04 · vence 07/05" },
        { label: "Nubank 07/06/26", amount: 512_310, detail: "ciclo 30/04–31/05 · vence 07/06" },
        {
          label: "Nubank 07/07/26",
          amount: 438_792,
          detail: "ciclo 31/05–30/06 · vence 07/07 · em conferência",
          accent: "attention",
        },
      ],
    });

    assert.equal(view?.kind, "invoices");
    assert.equal(view?.rows.length, 3);
    assert.deepEqual(view === null ? null : viewTransactionIds(view), []);
  });

  it("o histórico de faturas descarta a métrica — somar faturas seria conta de modelo", () => {
    // A forma não declara `metric`, e o schema tira o que não declarou. É de
    // propósito: um "total das faturas" só existiria se o modelo somasse
    // dinheiro, e é assim que um número inventado chega com cara de certo.
    // Descartar em silêncio é melhor que reprovar o painel inteiro — a lista,
    // que é a resposta, continua chegando.
    const view = parseView({
      kind: "invoices",
      title: "Faturas",
      metric: { label: "Total das faturas", amount: 1_342_142 },
      rows: [{ label: "Nubank 07/07/26", amount: 438_792 }],
    });

    assert.equal(view?.kind, "invoices");
    assert.equal("metric" in (view ?? {}), false);
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

  /**
   * A regra de proveniência deixou de ser uma lista de `kind` isentos e passou a
   * ser uma declaração POR LINHA. Estes testes cobrem os dois casos que a lista
   * não alcançava — e que existem no produto hoje.
   */
  it("ajuste no nível da fatura entra na proposta declarando a base", () => {
    // `prepare_invoice_resolution` devolve `targetTransactionId: null` porque
    // não HÁ linha culpada: o ajuste é da fatura. Sob a regra por `kind`, esta
    // proposta era inexprimível — e é a mais comum quando a conta não fecha.
    const view = parseView({
      kind: "proposal",
      title: "Ajuste para fechar a fatura",
      rows: [
        {
          label: "Ajuste de arredondamento",
          amount: 3,
          detail: "diferença da fatura, sem item culpado",
          basis: "document",
        },
      ],
    });

    assert.equal(view?.kind, "proposal");
    assert.equal(view?.rows[0]?.basis, "document");
  });

  it("projeção anual não se passa por soma das cobranças observadas", () => {
    const projected = parseView({
      kind: "recurrences",
      title: "Assinaturas",
      rows: [
        { label: "Streaming · custo anual", amount: 83_880, basis: "projection" },
        { label: "Streaming · cobranças vistas", amount: 13_980, transactionIds: ["t1", "t2"] },
      ],
    });

    assert.equal(projected?.kind, "recurrences");
    // A linha projetada não entra na proveniência clicável: não há o que abrir.
    assert.deepEqual(projected === null ? [] : viewTransactionIds(projected), ["t1", "t2"]);
  });

  it("declarar base não vale para o que é soma de lançamentos — mas a regra é por linha", () => {
    const issues = checkView({
      kind: "breakdown",
      title: "Composição",
      rows: [
        // Sem ids e sem base: é o defeito de sempre.
        { label: "Restaurantes", amount: 124_000, transactionIds: [] },
        { label: "Mercado", amount: 98_000, transactionIds: ["t1"] },
      ],
    } as never);

    assert.equal(issues.length, 1);
    assert.deepEqual(issues[0]?.path, ["rows", 0, "transactionIds"]);
    // A mensagem tem de dizer as DUAS saídas, senão o modelo só sabe desistir.
    assert.match(formatViewIssues(issues)[0] ?? "", /transactionIds/);
    assert.match(formatViewIssues(issues)[0] ?? "", /basis/);
  });

  it("toda forma declara o que sustenta seus números", () => {
    // O `Record` é exaustivo pelo tipo: uma forma nova não compila sem entrar
    // aqui. Este teste guarda o outro lado — que nenhuma sobrou de fora da
    // união, e que os três casos de fato do documento seguem sendo o que são.
    for (const kind of VIEW_KINDS) {
      assert.ok(DEFAULT_BASIS[kind] !== undefined, `${kind} sem base declarada`);
    }
    assert.equal(DEFAULT_BASIS.invoices, "document");
    assert.equal(DEFAULT_BASIS.checksum, "document");
    assert.equal(DEFAULT_BASIS.commitments, "schedule");
    assert.equal(DEFAULT_BASIS.breakdown, "ledger");
  });

  it("recusa base inventada — o vocabulário é fechado como o do accent", () => {
    const view = parseView({
      kind: "breakdown",
      title: "Composição",
      rows: [{ label: "Restaurantes", amount: 124_000, basis: "porque_eu_disse" }],
    });
    assert.equal(view, null);
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
