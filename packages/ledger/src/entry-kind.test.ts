import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { entryKindLabel, entryKindLabelPlural, hasNoSpend, nonSpendLabel } from "./entry-kind";
import { ENTRY_KINDS, type EntryKind, type Transaction } from "./types";

function tx(kind: EntryKind): Transaction {
  return {
    id: `t_${kind}`,
    date: "2026-06-10",
    originalDescription: kind,
    merchant: null,
    merchantKey: null,
    amount: 1_000,
    kind,
    installment: null,
    category: null,
    extractionConfidence: "alta",
    sourceDocument: "doc",
    page: null,
  };
}

describe("rótulos de natureza", () => {
  it("toda natureza tem rótulo — nenhuma cai no identificador", () => {
    // O detalhe do lançamento escrevia `card_payment` literalmente na tela. A
    // regra do produto é a mesma da categoria: a pessoa lê o rótulo, nunca o
    // slug — e ela não tinha como ser cumprida porque o rótulo não existia.
    for (const kind of ENTRY_KINDS) {
      assert.notEqual(entryKindLabel(kind), kind);
      assert.notEqual(entryKindLabelPlural(kind), kind);
      assert.match(entryKindLabel(kind), /^[A-ZÀ-Ú]/, `"${kind}" precisa de rótulo legível`);
    }
  });

  it("o plural vem de tabela, não de concatenar um 's'", () => {
    // `+ "s"` acerta em "Compra" e produz "cartãos" em "Pagamento com cartão".
    assert.equal(entryKindLabelPlural("card_payment"), "Pagamentos com cartão");
    assert.equal(entryKindLabelPlural("transfer"), "Transferências");
    assert.equal(entryKindLabelPlural("purchase"), "Compras");
  });
});

describe("recorte sem gasto", () => {
  it("as QUATRO naturezas que não são gasto são reconhecidas", () => {
    // O caso especial anterior cobria só `payment`, e uma consulta de
    // `card_payment` caía no buraco que ele dizia ter fechado.
    for (const kind of ["payment", "card_payment", "transfer", "income"] as const) {
      assert.equal(hasNoSpend([tx(kind)]), true, `"${kind}" não é gasto`);
    }
  });

  it("uma compra no meio já faz o recorte ter gasto", () => {
    assert.equal(hasNoSpend([tx("payment"), tx("purchase")]), false);
  });

  it("nomeia o que está no recorte", () => {
    assert.equal(nonSpendLabel([tx("card_payment")]), "Pagamentos com cartão");
    assert.equal(nonSpendLabel([tx("payment"), tx("transfer")]), "Lançamentos que não são gasto");
  });
});
