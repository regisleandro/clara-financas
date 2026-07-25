import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { categoryLabel } from "../agent/lib/categories";

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
});
