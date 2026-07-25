import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatCents, sumAmounts, verifyChecksum } from "./checksum";
import { ProposedBatchSchema, TransactionSchema, type Transaction } from "./types";

/**
 * A conferência é o que sustenta a hipótese H2: extração imperfeita vira
 * produto quando o sistema sabe se acertou. Estes testes cobrem os casos que
 * a spec cita explicitamente — parcela, estorno, encargo e pagamento.
 */

let counter = 0;
function tx(partial: Partial<Transaction> = {}): Transaction {
  counter += 1;
  return TransactionSchema.parse({
    id: partial.id ?? `t${counter}`,
    date: "2026-06-14",
    originalDescription: "COMPRA GENERICA",
    amount: 1000,
    extractionConfidence: "alta",
    sourceDocument: "doc_1",
    page: 1,
    ...partial,
  });
}

function batch(transactions: Transaction[], declaredTotal: number | null) {
  return ProposedBatchSchema.parse({
    documentId: "doc_1",
    declaredTotal,
    transactions,
  });
}

describe("verifyChecksum", () => {
  it("bate quando a soma iguala o total declarado", () => {
    const report = verifyChecksum(batch([tx({ amount: 2550 }), tx({ amount: 1200 })], 3750));

    assert.equal(report.result, "match");
    assert.equal(report.extractedTotal, 3750);
    assert.equal(report.difference, 0);
    assert.deepEqual(report.suspectItems, []);
  });

  it("desconta estorno, que é crédito contra uma compra do período", () => {
    // Compras 100,00 + 50,00; estorno -10,00 => 140,00
    const report = verifyChecksum(
      batch(
        [
          tx({ amount: 10000 }),
          tx({ amount: 5000 }),
          tx({ amount: -1000, kind: "refund", originalDescription: "ESTORNO" }),
        ],
        14000,
      ),
    );

    assert.equal(report.result, "match");
    assert.equal(report.extractedTotal, 14000);
  });

  it("IGNORA o pagamento da fatura anterior, que não compõe este total", () => {
    // Comportamento verificado contra uma fatura real do Nubank: o pagamento
    // aparece nos lançamentos, mas quita o ciclo passado. Somá-lo produzia
    // divergência do tamanho exato do pagamento.
    const semPagamento = verifyChecksum(
      batch([tx({ amount: 10000 }), tx({ amount: 5000 })], 15000),
    );
    const comPagamento = verifyChecksum(
      batch(
        [
          tx({ amount: 10000 }),
          tx({ amount: 5000 }),
          tx({ amount: -32516, kind: "payment", originalDescription: "PAGAMENTO RECEBIDO" }),
        ],
        15000,
      ),
    );

    assert.equal(semPagamento.result, "match");
    assert.equal(comPagamento.result, "match", "o pagamento não pode alterar a conferência");
    assert.equal(comPagamento.extractedTotal, semPagamento.extractedTotal);
  });

  it("um pagamento não entra na lista de suspeitos de uma divergência", () => {
    const report = verifyChecksum(
      batch(
        [
          tx({ amount: 10000, extractionConfidence: "baixa" }),
          tx({ amount: -32516, kind: "payment", extractionConfidence: "baixa" }),
        ],
        12500,
      ),
    );

    assert.equal(report.result, "mismatch");
    assert.ok(
      report.suspectItems.every((item) => item.amount !== -32516),
      "o pagamento não compõe o total, então não explica a divergência",
    );
  });

  it("soma encargos como despesa", () => {
    const report = verifyChecksum(
      batch([tx({ amount: 10000 }), tx({ amount: 347, kind: "fee", originalDescription: "IOF" })], 10347),
    );

    assert.equal(report.result, "match");
  });

  it("conta só a parcela do período, não o valor total da compra", () => {
    // Compra de 1.200,00 em 12x: nesta fatura entram 100,00.
    const report = verifyChecksum(
      batch([tx({ amount: 10000, installment: { current: 3, total: 12 } })], 10000),
    );

    assert.equal(report.result, "match");
    assert.equal(report.extractedTotal, 10000);
  });

  it("acusa divergência e informa o tamanho dela", () => {
    const report = verifyChecksum(batch([tx({ amount: 10000 })], 12500));

    assert.equal(report.result, "mismatch");
    assert.equal(report.difference, -2500, "extraímos 25,00 a menos que o declarado");
  });

  it("aponta primeiro o item cujo valor é exatamente a diferença", () => {
    // Extraímos 30,00 a mais, e há um item de exatamente 30,00 — provável
    // leitura duplicada. Ele deve vir na frente até de um item de baixa
    // confiança, porque a coincidência de valor é evidência mais forte.
    const report = verifyChecksum(
      batch(
        [
          tx({ id: "alta-3000", amount: 3000, extractionConfidence: "alta" }),
          tx({ id: "baixa-9999", amount: 9999, extractionConfidence: "baixa" }),
          tx({ id: "alta-5000", amount: 5000, extractionConfidence: "alta" }),
        ],
        14999,
      ),
    );

    assert.equal(report.result, "mismatch");
    assert.equal(report.difference, 3000);
    assert.equal(report.suspectItems[0]?.transactionId, "alta-3000");
    assert.match(report.suspectItems[0]?.reason ?? "", /exatamente a diferença/);
  });

  it("na ausência de coincidência, prioriza menor confiança", () => {
    const report = verifyChecksum(
      batch(
        [
          tx({ id: "alta", amount: 5000, extractionConfidence: "alta" }),
          tx({ id: "media", amount: 4000, extractionConfidence: "media" }),
          tx({ id: "baixa", amount: 3000, extractionConfidence: "baixa" }),
        ],
        99999,
      ),
    );

    assert.deepEqual(
      report.suspectItems.map((item) => item.transactionId),
      ["baixa", "media"],
      "itens de alta confiança não entram como suspeitos quando não há coincidência de valor",
    );
  });

  it("trata ausência de total declarado como caso próprio, não como divergência", () => {
    const report = verifyChecksum(batch([tx({ amount: 10000 })], null));

    assert.equal(report.result, "no_declared_total");
    assert.equal(report.declaredTotal, null);
    assert.equal(report.difference, null);
    assert.deepEqual(report.suspectItems, [], "sem total declarado não há divergência a explicar");
  });

  it("lote vazio com total zero bate", () => {
    const report = verifyChecksum(batch([], 0));
    assert.equal(report.result, "match");
    assert.equal(report.extractedTotal, 0);
  });

  it("não aceita tolerância por padrão — dinheiro bate ao centavo", () => {
    const report = verifyChecksum(batch([tx({ amount: 10001 })], 10000));
    assert.equal(report.result, "mismatch", "um centavo de diferença é divergência");
    assert.equal(report.difference, 1);
  });

  it("respeita tolerância quando explicitamente pedida", () => {
    const report = verifyChecksum(batch([tx({ amount: 10001 })], 10000), 1);
    assert.equal(report.result, "match");
  });
});

describe("aritmética de dinheiro", () => {
  it("soma em inteiros, sem erro de ponto flutuante", () => {
    // Em float, 0.1 + 0.2 !== 0.3. Em centavos, 10 + 20 === 30, sempre.
    const total = sumAmounts([tx({ amount: 10 }), tx({ amount: 20 })]);
    assert.equal(total, 30);
    assert.ok(Number.isInteger(total));
  });

  it("recusa valor fracionário no schema", () => {
    assert.throws(() => TransactionSchema.parse({ ...tx(), amount: 10.5 }));
  });
});

describe("formatCents", () => {
  it("formata em BRL", () => {
    assert.match(formatCents(123456), /1\.234,56/);
    assert.match(formatCents(-500), /5,00/);
  });
});

describe("causa provável da divergência", () => {
  it("classifica poucos centavos em muitos itens como arredondamento", () => {
    // O caso real: 48 lançamentos, 1 centavo de diferença vindo do IOF.
    const many = Array.from({ length: 48 }, () => tx({ amount: 1000 }));
    const report = verifyChecksum(batch(many, 48000 + 1));

    assert.equal(report.result, "mismatch");
    assert.equal(report.likelyCause, "rounding");
    assert.deepEqual(
      report.suspectItems,
      [],
      "arredondamento não tem culpado; apontar itens seria falsa precisão",
    );
  });

  it("classifica coincidência exata de valor como item, não arredondamento", () => {
    const report = verifyChecksum(
      batch([tx({ id: "culpado", amount: 3 }), tx({ amount: 1000 })], 1000),
    );

    assert.equal(report.likelyCause, "item");
    assert.equal(report.suspectItems[0]?.transactionId, "culpado");
  });

  it("divergência grande não é arredondamento", () => {
    const report = verifyChecksum(batch([tx({ amount: 10000 })], 50000));

    assert.equal(report.likelyCause, "unknown");
    assert.ok(report.suspectItems.length > 0, "aqui vale listar onde olhar");
  });
});
