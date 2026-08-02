import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeInvoice, IDENTIFIER_PATTERN } from "./invoice-name";

/**
 * O defeito que estes testes fecham foi relatado assim: *"quando clico em
 * comparar duas faturas ele exibe: Compare a fatura bat_52513dece22e438b9ee9
 * com a bat_cdcff3fbdb3648909b63"*.
 *
 * A regra já existia — o prompt do coordenador diz que identificador nunca é
 * mostrado, e há teste cobrando isso — mas ela valia para o que a Clara
 * escreve. Os atalhos da tela de boas-vindas montavam a mensagem da PESSOA
 * interpolando o `batchId`, e nada olhava para esse lado.
 */
describe("como uma fatura é nomeada para a pessoa", () => {
  it("emissor e mês, SEM artigo — quem monta a frase põe o artigo certo", () => {
    assert.equal(
      describeInvoice({ issuer: "Nubank", periodEnd: "2026-06-30" }),
      "fatura do Nubank de junho de 2026",
    );
  });

  it("sem ciclo, o emissor sozinho — não se inventa um mês", () => {
    assert.equal(describeInvoice({ issuer: "Itaú", periodEnd: null }), "fatura do Itaú");
  });

  it("sem emissor, o mês sozinho", () => {
    assert.equal(
      describeInvoice({ issuer: null, periodEnd: "2026-04-30" }),
      "fatura de abril de 2026",
    );
  });

  it("sem nada, fica vago em vez de inventar precisão", () => {
    assert.equal(describeInvoice({ issuer: null, periodEnd: null }), "última fatura");
    assert.equal(describeInvoice({ issuer: "   ", periodEnd: "" }), "última fatura");
  });

  it("nenhuma forma produz identificador — é a regra que foi quebrada", () => {
    const casos = [
      { issuer: "Nubank", periodEnd: "2026-06-30" },
      { issuer: null, periodEnd: "2026-06-30" },
      { issuer: "Itaú", periodEnd: null },
      { issuer: null, periodEnd: null },
    ];
    for (const caso of casos) {
      assert.doesNotMatch(describeInvoice(caso), IDENTIFIER_PATTERN);
    }
  });

  it("o padrão de identificador reconhece as formas que o produto emite", () => {
    // Sem isto o teste acima passaria por não saber o que procurar.
    assert.match("bat_52513dece22e438b9ee9", IDENTIFIER_PATTERN);
    assert.match("Compare a fatura bat_cdcff3fbdb3648909b63 com a outra", IDENTIFIER_PATTERN);
    assert.match("doc_1a2b3c4d5e6f", IDENTIFIER_PATTERN);
    assert.match("txn_2513c62017c8", IDENTIFIER_PATTERN);
    // E não confunde palavra comum com id.
    assert.doesNotMatch("fatura do Nubank de junho de 2026", IDENTIFIER_PATTERN);
    assert.doesNotMatch("bat_ab", IDENTIFIER_PATTERN);
  });

  /**
   * Duas faturas do mesmo emissor no mesmo mês descrevem-se igual, e é por isso
   * que `starters` desempata pela data de fechamento. O caso existe: fatura
   * parcial e fechamento do mesmo ciclo, ou o mesmo PDF enviado duas vezes.
   */
  it("mesmo emissor e mês produzem a MESMA descrição — quem chama precisa desempatar", () => {
    const a = describeInvoice({ issuer: "Nubank", periodEnd: "2026-06-15" });
    const b = describeInvoice({ issuer: "Nubank", periodEnd: "2026-06-30" });
    assert.equal(a, b);
  });
});
