import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aggregateByCategory,
  comparePeriods,
  detectRecurrences,
  totalSpend,
} from "./analysis";
import { TransactionSchema, type Transaction } from "./types";

let counter = 0;
function tx(partial: Partial<Transaction> = {}): Transaction {
  counter += 1;
  return TransactionSchema.parse({
    id: partial.id ?? `t${counter}`,
    date: "2026-06-14",
    originalDescription: "COMPRA",
    amount: 1000,
    extractionConfidence: "alta",
    sourceDocument: "doc_1",
    page: 1,
    ...partial,
  });
}

describe("proveniência estrutural", () => {
  it("todo total carrega os ids que o compõem", () => {
    const rows = [tx({ id: "a", amount: 1000 }), tx({ id: "b", amount: 2000 })];
    const total = totalSpend(rows);

    assert.equal(total.value, 3000);
    assert.deepEqual(total.transactionIds.sort(), ["a", "b"]);
  });

  it("os ids de cada categoria somam exatamente o valor dela", () => {
    const rows = [
      tx({ id: "a", amount: 1000, category: "groceries" }),
      tx({ id: "b", amount: 2000, category: "groceries" }),
      tx({ id: "c", amount: 500, category: "dining" }),
    ];

    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const bucket of aggregateByCategory(rows)) {
      const recomputed = bucket.transactionIds.reduce(
        (sum, id) => sum + (byId.get(id)?.amount ?? 0),
        0,
      );
      assert.equal(recomputed, bucket.value, `categoria ${bucket.category} não reconstrói`);
    }
  });

  it("pagamento não entra em gasto — não é despesa do período", () => {
    const rows = [
      tx({ id: "a", amount: 1000 }),
      tx({ id: "pg", amount: -50000, kind: "payment" }),
    ];

    assert.equal(totalSpend(rows).value, 1000);
    assert.ok(!totalSpend(rows).transactionIds.includes("pg"));
  });
});

describe("aggregateByCategory", () => {
  it("ordena do maior para o menor e calcula participação", () => {
    const result = aggregateByCategory([
      tx({ amount: 1000, category: "dining" }),
      tx({ amount: 3000, category: "groceries" }),
    ]);

    assert.equal(result[0]?.category, "groceries");
    assert.equal(result[0]?.share, 0.75);
    assert.equal(result[1]?.share, 0.25);
  });

  it("mostra o não categorizado em vez de escondê-lo", () => {
    const result = aggregateByCategory([tx({ amount: 1000 }), tx({ amount: 500, category: "x" })]);
    const semCategoria = result.find((bucket) => bucket.category === null);

    assert.ok(semCategoria, "o que falta categorizar é o que precisa de atenção");
    assert.equal(semCategoria.value, 1000);
  });
});

describe("comparePeriods", () => {
  it("atribui a variação a quem de fato a explica", () => {
    // Restaurantes sobe 800; mercado sobe 200. Restaurantes explica 80%.
    const anterior = [
      tx({ amount: 1000, category: "dining" }),
      tx({ amount: 1000, category: "groceries" }),
    ];
    const atual = [
      tx({ amount: 1800, category: "dining" }),
      tx({ amount: 1200, category: "groceries" }),
    ];

    const { totalDelta, categories } = comparePeriods(atual, anterior);

    assert.equal(totalDelta, 1000);
    const dining = categories.find((c) => c.category === "dining");
    assert.equal(dining?.delta, 800);
    assert.equal(dining?.shareOfChange, 0.8);
  });

  it("não confunde variação relativa grande com relevância", () => {
    // Uma categoria dobra (10 -> 20) e outra sobe 800 sobre 1000.
    const anterior = [
      tx({ amount: 10, category: "pequena" }),
      tx({ amount: 1000, category: "grande" }),
    ];
    const atual = [
      tx({ amount: 20, category: "pequena" }),
      tx({ amount: 1800, category: "grande" }),
    ];

    const { categories } = comparePeriods(atual, anterior);
    const pequena = categories.find((c) => c.category === "pequena");
    const grande = categories.find((c) => c.category === "grande");

    assert.equal(pequena?.deltaRatio, 1, "dobrou, em termos relativos");
    assert.ok(
      (grande?.shareOfChange ?? 0) > (pequena?.shareOfChange ?? 0),
      "mas quem explica o aumento é a categoria grande",
    );
  });

  it("categoria nova não quebra a razão de variação", () => {
    const { categories } = comparePeriods([tx({ amount: 500, category: "nova" })], []);
    const nova = categories.find((c) => c.category === "nova");

    assert.equal(nova?.deltaRatio, null, "sem base anterior não há razão a calcular");
    assert.equal(nova?.delta, 500);
  });
});

describe("detectRecurrences", () => {
  const mensal = (merchant: string, amounts: number[]) =>
    amounts.map((amount, index) =>
      tx({
        id: `${merchant}-${index}`,
        merchant,
        amount,
        date: `2026-0${index + 1}-10`,
        category: "subscriptions",
      }),
    );

  it("reconhece cobrança mensal ainda que o preço mude", () => {
    const rows = mensal("Nuvem Digital", [1000, 1000, 1430]);
    const [recorrencia] = detectRecurrences(rows);

    assert.equal(recorrencia?.merchant, "Nuvem Digital");
    assert.equal(recorrencia?.occurrences, 3);
    assert.equal(recorrencia?.latestAmount, 1430);
    assert.ok(Math.abs((recorrencia?.priceChangeRatio ?? 0) - 0.43) < 0.001);
    assert.equal(recorrencia?.annualizedCents, 1430 * 12);
  });

  it("ignora compras esparsas no mesmo comerciante", () => {
    const rows = [
      tx({ merchant: "Mercado", date: "2026-01-02" }),
      tx({ merchant: "Mercado", date: "2026-01-05" }),
      tx({ merchant: "Mercado", date: "2026-01-09" }),
    ];

    assert.deepEqual(detectRecurrences(rows), [], "3 compras na mesma semana não é assinatura");
  });

  it("exige um mínimo de ocorrências", () => {
    assert.deepEqual(detectRecurrences(mensal("Curta", [1000, 1000])), []);
  });

  it("ordena pelo custo anual, que é o que importa decidir", () => {
    const rows = [...mensal("Cara", [5000, 5000, 5000]), ...mensal("Barata", [900, 900, 900])];
    const result = detectRecurrences(rows);

    assert.equal(result[0]?.merchant, "Cara");
  });
});
