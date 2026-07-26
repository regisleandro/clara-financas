import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clusterMerchantKeys, isTruncationOf, merchantKey } from "./merchant";

/**
 * Os casos abaixo são LITERAIS: saíram de duas faturas Nubank reais, do mesmo
 * cartão, em ciclos consecutivos. É por isso que o teste vale — não são
 * exemplos inventados para o normalizador passar.
 */
const key = (originalDescription: string, merchant: string | null = null) =>
  merchantKey({ originalDescription, merchant });

describe("ruído do emissor que não é identidade", () => {
  it("tira a máscara do cartão", () => {
    assert.equal(key("•••• 0495 Est Villa Romana"), "est villa romana");
    assert.equal(key("**** 1234 Padaria Central"), "padaria central");
  });

  it("tira a cauda de conversão de moeda, que muda a cada cobrança", () => {
    // A MESMA assinatura, em dois meses: o câmbio entrou na descrição.
    const maio = key("•••• 4851 Cursor, Ai Powered Ide USD 10.00 Conversão: USD 1 = R$ 5,26");
    const junho = key("Cursor, Ai Powered Ide");

    assert.equal(maio, "cursor ai powered ide");
    assert.equal(maio, junho);
  });

  it("tira o número da parcela, que muda todo mês por construção", () => {
    const setima = key("•••• 4851 Globo Globoplay - Parcela 7/12");
    const oitava = key("Globo Globoplay - Parcela 8/12");

    assert.equal(setima, "globo globoplay");
    assert.equal(setima, oitava);
  });

  it("desembrulha o IOF para o comerciante que o gerou", () => {
    // Este é o caso que matava a detecção de recorrência: a linha de IOF
    // entrava como cobrança independente, no mesmo dia, zerando o intervalo.
    assert.equal(key('IOF de "Claude.Ai Subscription"'), "claude ai subscription");
    assert.equal(key('IOF de "Github, Inc."'), "github inc");
  });

  it("tira o prefixo do intermediário, que é meio de pagamento e não loja", () => {
    assert.equal(key("Dl*Google Medium"), "google medium");
    assert.equal(key("Mp *Melimais"), "melimais");
    assert.equal(key("Pg *Vertex"), "vertex");
  });

  /**
   * Todas as grafias abaixo saíram de UMA fatura real, e são o motivo de a
   * regra ser posicional em vez de uma lista de adquirentes conhecidos: a mesma
   * loja aparece atrás de intermediários diferentes na mesma fatura.
   */
  it("não depende de conhecer o intermediário: o que vem antes do * é roteamento", () => {
    assert.equal(key("•••• 0052 Ec *Melimais"), key("Mp *Melimais"));
    assert.equal(key("•••• 4851 Ppro *Microsoft"), key("Microsoft*Microsoft"));
    assert.equal(key("•••• 4851 99app *99app"), "99app");
    assert.equal(key("Amazonmktplc*Lebrestor"), "lebrestor");
  });

  it("o IOF de uma cobrança intermediada casa com a cobrança", () => {
    // Antes da regra posicional estas duas linhas produziam chaves diferentes,
    // e o encargo virava uma cobrança solta no lugar de somar na compra.
    assert.equal(
      key('IOF de "Openai *Chatgpt Subscr"'),
      key("•••• 4851 Openai *Chatgpt Subscr"),
    );
  });

  it("não come uma descrição que só por acaso tem asterisco", () => {
    // Sem comerciante depois do prefixo não há o que extrair: a linha inteira
    // vale mais que um resto vazio.
    assert.equal(key("Melimais*"), "melimais");
    assert.equal(key("Promoção 2 * 1 na Padaria"), "promocao 2 1 na padaria");
  });

  it("tira o sufixo do arranjo de pagamento", () => {
    assert.equal(key("Petlove - NuPay"), "petlove");
    assert.equal(key("iFood - NuPay"), "ifood");
  });

  it("normaliza acento e pontuação, que variam entre faturas", () => {
    assert.equal(key("Restaurante Açaí & Cia."), "restaurante acai cia");
  });

  it("prefere o campo merchant quando ele existe, e cai na descrição quando não", () => {
    assert.equal(key("•••• 0495 lixo ilegível", "Casa do Frango"), "casa do frango");
    assert.equal(key("Casa do Frango", ""), "casa do frango");
    assert.equal(key("Casa do Frango", null), "casa do frango");
  });

  it("devolve null quando não há identidade a extrair", () => {
    assert.equal(key(""), null);
    assert.equal(key("•••• 4851"), null);
  });
});

describe("truncamento: a fatura corta a descrição em larguras diferentes", () => {
  it("reconhece o corte quando os tokens anteriores batem", () => {
    assert.ok(isTruncationOf("cursor ai powered", "cursor ai powered ide"));
    assert.ok(isTruncationOf("transportes edemar rus", "transportes edemar russo"));
  });

  it("NÃO funde comerciantes que só compartilham o começo", () => {
    // O erro caro: fundir estes dois some com dinheiro de um e faz aparecer
    // no outro, sem nada na tela indicando que houve fusão.
    assert.equal(isTruncationOf("google youtube", "google medium"), false);
    assert.equal(isTruncationOf("amazon prime canais", "amazon ad free for pri"), false);
    assert.equal(isTruncationOf("posto shell", "posto ipiranga"), false);
  });

  it("desconfia de um último token de uma letra só, que é puro ruído de corte", () => {
    assert.equal(isTruncationOf("posto a", "posto amarelo"), false);
    // Com contexto suficiente antes dele, o corte volta a ser evidência.
    assert.ok(isTruncationOf("google mubi c", "google mubi curated c"));
  });
});

describe("agrupamento", () => {
  it("escolhe o mesmo representante independentemente da ordem de chegada", () => {
    const forward = clusterMerchantKeys(["google mubi c", "google mubi curated c"]);
    const backward = clusterMerchantKeys(["google mubi curated c", "google mubi c"]);

    assert.equal(forward.get("google mubi curated c"), "google mubi c");
    assert.deepEqual([...forward.entries()].sort(), [...backward.entries()].sort());
  });

  /**
   * O caso que a normalização determinística se RECUSA a resolver sozinha:
   * nenhuma regra de string sabe que a Anthropic vende o Claude. Quem sabe é a
   * pessoa, e o apelido aprovado é o canal para ela dizer isso.
   */
  it("funde grafias diferentes da mesma empresa quando há apelido aprovado", () => {
    const keys = ["claude ai subscription", "anthropic claude sub", "netflix com"];

    const semApelido = clusterMerchantKeys(keys);
    assert.equal(new Set(semApelido.values()).size, 3, "sozinha, ela não adivinha");

    const comApelido = clusterMerchantKeys(keys, [
      ["claude ai subscription", "anthropic claude sub"],
    ]);
    assert.equal(
      comApelido.get("claude ai subscription"),
      comApelido.get("anthropic claude sub"),
      "com o apelido, viram um só comerciante",
    );
    assert.notEqual(comApelido.get("netflix com"), comApelido.get("anthropic claude sub"));
  });

  it("o apelido leva o grupo inteiro, não só a grafia citada", () => {
    // "google mubi c" já reunia duas grafias por truncamento; o apelido tem de
    // arrastar as duas, senão metade do dinheiro fica para trás.
    const clustered = clusterMerchantKeys(
      ["google mubi c", "google mubi curated c", "mubi"],
      [["mubi", "google mubi c"]],
    );

    assert.equal(new Set(clustered.values()).size, 1, "as três formas são um comerciante");
  });

  it("um apelido que cita chave inexistente não quebra nem inventa grupo", () => {
    const clustered = clusterMerchantKeys(["netflix com"], [["nao existe", "tambem nao"]]);
    assert.equal(clustered.get("netflix com"), "netflix com");
  });

  it("mantém separados os comerciantes que apenas se parecem", () => {
    const clustered = clusterMerchantKeys([
      "google youtube",
      "google medium",
      "google one",
    ]);

    assert.equal(new Set(clustered.values()).size, 3);
  });

  /**
   * As duas listas fechadas que sobraram aqui foram revistas. O que importa é
   * o par de garantias: a normalização alcança o que antes escapava, e não
   * passa a comer nome de comerciante.
   */
  it("normaliza câmbio em qualquer moeda, não só nas quatro conhecidas", () => {
    const usd = merchantKey({
      originalDescription: "Cursor, Ai Powered Ide USD 10.00",
      merchant: null,
    });
    for (const currency of ["CAD", "JPY", "ARS", "CHF"]) {
      assert.equal(
        merchantKey({
          originalDescription: `Cursor, Ai Powered Ide ${currency} 10,00`,
          merchant: null,
        }),
        usd,
        `compra em ${currency} tem de agrupar com a mesma loja`,
      );
    }
  });

  it("um número no fim do nome NÃO é confundido com câmbio", () => {
    // Sem exigir centavos, "Sul 2" viraria cauda de conversão e o nome
    // perderia a última palavra — erro invisível, do pior tipo.
    assert.notEqual(
      merchantKey({ originalDescription: "PADARIA SUL 2", merchant: null }),
      merchantKey({ originalDescription: "PADARIA", merchant: null }),
    );
  });

  it("sufixo de meio de pagamento sai; palavra do nome fica", () => {
    assert.equal(
      merchantKey({ originalDescription: "MERCADO CENTRAL - PIX", merchant: null }),
      merchantKey({ originalDescription: "MERCADO CENTRAL", merchant: null }),
    );
    // "Central" tem a mesma forma de um sufixo de arranjo, e é parte do nome.
    assert.notEqual(
      merchantKey({ originalDescription: "PADARIA - CENTRAL", merchant: null }),
      merchantKey({ originalDescription: "PADARIA", merchant: null }),
    );
  });
});
