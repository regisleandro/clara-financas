import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ViewSchema } from "@clara-financas/views";

import { deriveFollowups } from "./followups";

/**
 * Os follow-ups do turno vêm do PAINEL que acabou de aparecer; os do servidor
 * vêm do razão. Estes testes fixam a ordem (contexto imediato primeiro), a
 * deduplicação e o teto — a fileira de pílulas não pode virar menu.
 */

const breakdown = ViewSchema.parse({
  kind: "breakdown",
  title: "Para onde foi o dinheiro",
  rows: [
    { label: "Restaurantes", amount: 84210, transactionIds: ["t1"] },
    { label: "Mercado", amount: 51000, transactionIds: ["t2"] },
  ],
});

describe("deriveFollowups", () => {
  it("breakdown sugere abrir os lançamentos da maior categoria", () => {
    const result = deriveFollowups(breakdown, ["Comparar com o mês passado"]);
    assert.equal(result[0], "Ver os lançamentos de Restaurantes");
    assert.ok(result.includes("Comparar com o mês passado"));
  });

  it("sem painel, passam só os do servidor", () => {
    assert.deepEqual(deriveFollowups(null, ["A", "B"]), ["A", "B"]);
  });

  it("não duplica quando o servidor sugere o mesmo caminho", () => {
    const result = deriveFollowups(breakdown, ["Ver os lançamentos de Restaurantes", "Outro"]);
    assert.equal(
      result.filter((item) => item === "Ver os lançamentos de Restaurantes").length,
      1,
    );
  });

  it("capado em quatro — pílulas, não menu", () => {
    const result = deriveFollowups(breakdown, ["A", "B", "C", "D", "E"]);
    assert.equal(result.length, 4);
  });

  it("checksum só sugere investigar quando há divergência", () => {
    const mismatch = ViewSchema.parse({
      kind: "checksum",
      batchId: "bat_1",
      title: "Conferência",
      declaredTotal: 100,
      extractedTotal: 99,
      difference: -1,
      result: "mismatch",
    });
    const match = ViewSchema.parse({
      ...mismatch,
      extractedTotal: 100,
      difference: 0,
      result: "match",
    });

    assert.ok(deriveFollowups(mismatch, []).includes("Onde está a diferença?"));
    assert.ok(!deriveFollowups(match, []).includes("Onde está a diferença?"));
  });
});
