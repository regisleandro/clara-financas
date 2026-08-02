import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { categoryLabel } from "./categories";

/**
 * O identificador é inglês por decisão de projeto; a interface é inteiramente
 * em português. Estes testes fixam a fronteira entre os dois — que é onde o id
 * vazava para o usuário final, aparecendo como "dining" na tela e na fala da
 * Clara.
 */

const labels = {
  groceries: "Mercado",
  dining: "Restaurantes",
  fees: "Encargos e impostos",
};

describe("categoryLabel", () => {
  it("traduz o identificador para o nome da constituição", () => {
    assert.equal(categoryLabel(labels, "dining"), "Restaurantes");
    assert.equal(categoryLabel(labels, "fees"), "Encargos e impostos");
  });

  it("sem categoria tem nome próprio, não fica em branco", () => {
    // Vazio na tela some; "Sem categoria" é visível e resolvível — e é
    // justamente o que a pessoa precisa ver para pedir a correção.
    assert.equal(categoryLabel(labels, null), "Sem categoria");
  });

  it("categoria sem conceito cai para o identificador, sem inventar nome", () => {
    // Acontece quando uma regra aponta para categoria removida depois. O id
    // cru é feio, mas expõe a inconsistência em vez de escondê-la.
    assert.equal(categoryLabel(labels, "petrochemicals"), "petrochemicals");
  });

  it("mapa vazio não quebra — devolve o identificador", () => {
    assert.equal(categoryLabel({}, "dining"), "dining");
  });

  /**
   * Relatado em produção: *"apareceram vários itens com
   * categories/entertainment - sem tradução"*.
   *
   * O razão guarda o slug, mas `propose_batch` aceitava a categoria sem
   * normalizar e o modelo mandava o CAMINHO do conceito — que é o que ele tem
   * fresco em mãos depois de ler ou criar a categoria. O docblock de
   * `categorySlug` já dizia que as duas formas são aceitas; a busca só olhava
   * uma delas.
   */
  it("aceita o CAMINHO do conceito, não só o slug", () => {
    assert.equal(categoryLabel(labels, "categories/dining"), "Restaurantes");
    assert.equal(categoryLabel(labels, "categories/groceries"), "Mercado");
  });

  it("caminho de categoria inexistente cai para o próprio caminho, sem inventar", () => {
    assert.equal(categoryLabel(labels, "categories/petrochemicals"), "categories/petrochemicals");
  });

  it("um mapa com a chave no formato caminho continua funcionando", () => {
    // Defesa contra a ordem inversa: se algum dia um carregador guardar a
    // chave sem normalizar, a busca não pode deixar de encontrar.
    assert.equal(categoryLabel({ "categories/pets": "Pets" }, "categories/pets"), "Pets");
  });
});
