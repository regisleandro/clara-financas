import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countOf,
  deltaOf,
  documentFact,
  project,
  reconcile,
  rowsSumToMetric,
  sumOf,
  witnessOf,
  type Figure,
} from "./figure";

/**
 * Cada teste aqui corresponde a um defeito REAL que estava em produção — a
 * lista veio de auditar os painéis do analista, não de imaginar o que poderia
 * dar errado.
 */

const razao = [
  { id: "t1", amount: 10_000 },
  { id: "t2", amount: -2_000 },
  { id: "t3", amount: 5_000 },
];
const testemunha = witnessOf(razao);

describe("soma", () => {
  it("reconstrói o valor a partir dos ids", () => {
    assert.deepEqual(reconcile(sumOf(razao), testemunha), []);
  });

  it("acusa valor que não corresponde aos ids", () => {
    // O defeito na sua forma mais pura: o número foi por um caminho e os ids
    // por outro.
    const adulterada: Figure = { ...sumOf(razao), value: 99_999 };
    const [violacao] = reconcile(adulterada, testemunha);

    assert.equal(violacao?.reason, "soma_nao_confere");
    assert.equal(violacao?.expected, 13_000);
    assert.equal(violacao?.got, 99_999);
  });

  it("acusa id que não existe no razão", () => {
    // Acontece quando o recorte muda entre montar o número e montar a lista:
    // o valor fica de um período e um id sobra de outro.
    const orfa: Figure = { value: 0, transactionIds: ["t404"], basis: { kind: "sum" } };

    assert.equal(reconcile(orfa, testemunha)[0]?.reason, "lancamento_desconhecido");
  });

  it("recorte vazio é um número válido, não um erro", () => {
    assert.deepEqual(reconcile(sumOf([]), testemunha), []);
  });
});

describe("diferença", () => {
  it("os dois lados reconciliam e a subtração fecha", () => {
    const atual = sumOf([razao[0]!]);
    const anterior = sumOf([razao[2]!]);
    const variacao = deltaOf(atual, anterior);

    assert.equal(variacao.value, 5_000);
    assert.deepEqual(reconcile(variacao, testemunha), []);
  });

  it("os ids são a união dos dois lados — e o basis diz que são", () => {
    // Era exatamente isto que `compare_periods` e `analyze_series` faziam, só
    // que anexado a um valor que se apresentava como soma. A união continua
    // certa; o que faltava era declarar que aquilo é uma diferença.
    const variacao = deltaOf(sumOf([razao[0]!]), sumOf([razao[2]!]));

    assert.deepEqual([...variacao.transactionIds].sort(), ["t1", "t3"]);
    assert.deepEqual(reconcile(variacao, testemunha), []);
  });

  it("acusa diferença cujo valor não bate com os lados", () => {
    const adulterada: Figure = {
      ...deltaOf(sumOf([razao[0]!]), sumOf([razao[2]!])),
      value: 1,
    };

    assert.equal(reconcile(adulterada, testemunha)[0]?.reason, "diferenca_nao_confere");
  });

  it("acusa um lado que não reconcilia, apontando qual", () => {
    const ladoRuim: Figure = { ...sumOf([razao[0]!]), value: 123 };
    const variacao = deltaOf(ladoRuim, sumOf([razao[2]!]));
    const violacoes = reconcile(variacao, testemunha);

    assert.ok(violacoes.some((v) => v.path.endsWith(".minuendo")));
  });
});

describe("projeção", () => {
  it("o custo anualizado declara o fator e reconcilia pela base", () => {
    // `detect_recurrences` anexava os ids das cobranças REAIS a um valor
    // projetado para 365 dias. Os ids somavam uma coisa, o número dizia outra,
    // e conferir dava sempre errado.
    const cobrancas = sumOf([{ id: "t1", amount: 10_000 }]);
    const anual = project(cobrancas, 12);

    assert.equal(anual.value, 120_000);
    assert.deepEqual(reconcile(anual, testemunha), []);
    assert.equal(anual.basis.kind === "projection" ? anual.basis.factor : null, 12);
  });

  it("arredonda para centavos inteiros", () => {
    const anual = project(sumOf([{ id: "t3", amount: 5_000 }]), 365 / 30);

    assert.ok(Number.isInteger(anual.value));
    assert.deepEqual(reconcile(anual, testemunha), []);
  });

  it("acusa projeção que não corresponde ao fator", () => {
    const adulterada: Figure = { ...project(sumOf([razao[0]!]), 12), value: 7 };

    assert.equal(reconcile(adulterada, testemunha)[0]?.reason, "projecao_nao_confere");
  });

  it("recusa fator não finito em vez de produzir NaN", () => {
    // Uma recorrência com intervalo zero produzia `365/0`. `NaN` num painel
    // financeiro é o pior tipo de defeito: some na formatação.
    assert.throws(() => project(sumOf(razao), Number.POSITIVE_INFINITY));
    assert.throws(() => project(sumOf(razao), Number.NaN));
  });
});

describe("fato do documento e contagem", () => {
  it("um total declarado não carrega lançamento", () => {
    assert.deepEqual(reconcile(documentFact(150_000), testemunha), []);
  });

  it("acusa fato do documento com proveniência anexada", () => {
    // Um número que finge ser derivado do razão quando veio do papel.
    const mentiroso: Figure = { ...documentFact(1), transactionIds: ["t1"] };

    assert.equal(reconcile(mentiroso, testemunha)[0]?.reason, "fato_com_lancamento");
  });

  it("contagem não é dinheiro e não tem proveniência", () => {
    const seis = countOf(6);

    assert.equal(seis.basis.kind, "count");
    assert.deepEqual(reconcile(seis, testemunha), []);
  });
});

describe("as linhas somam o número em destaque", () => {
  it("bruto em tudo: as linhas fecham com o topo", () => {
    // O defeito nº1 de confiança: o topo mostrava LÍQUIDO (13.000) e as linhas
    // BRUTO (10.000 + 5.000 = 15.000). Somar o que está na tela dava 20 reais a
    // mais que o número em destaque logo acima.
    const compras = [
      { id: "t1", amount: 10_000 },
      { id: "t3", amount: 5_000 },
    ];
    const topo = sumOf(compras);
    const linhas = [sumOf([compras[0]!]), sumOf([compras[1]!])];

    assert.equal(topo.value, 15_000);
    assert.deepEqual(rowsSumToMetric(topo, linhas), []);
  });

  it("acusa quando as linhas não somam o topo", () => {
    const topo = sumOf(razao); // líquido: 13.000
    const linhas = [sumOf([razao[0]!]), sumOf([razao[2]!])]; // bruto: 15.000
    const [violacao] = rowsSumToMetric(topo, linhas);

    assert.equal(violacao?.reason, "soma_nao_confere");
    assert.equal(violacao?.expected, 15_000);
    assert.equal(violacao?.got, 13_000);
  });

  it("líquido é a soma de tudo, não uma diferença", () => {
    // No razão o crédito JÁ é negativo (ver `types.ts`: "valor é sinalizado").
    // Então o líquido é uma soma simples sobre o recorte inteiro — usar
    // `deltaOf(compras, creditos)` subtrairia um número já negativo e daria
    // 17.000. É a mesma armadilha de sinal que a regra de sinalização existe
    // para evitar, e ela pega quem tratar "crédito" como quantidade positiva.
    const compras = sumOf([razao[0]!, razao[2]!]);
    const creditos = sumOf([razao[1]!]);
    const liquido = sumOf(razao);

    assert.equal(compras.value, 15_000);
    assert.equal(creditos.value, -2_000);
    assert.equal(liquido.value, 13_000);
    assert.equal(compras.value + creditos.value, liquido.value);
    assert.deepEqual(reconcile(liquido, testemunha), []);
  });
});
