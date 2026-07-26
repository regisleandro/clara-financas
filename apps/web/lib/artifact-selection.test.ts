import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { View } from "@clara-financas/views";

import { artifactKey, resolveActive, type MessageArtifact } from "./artifact-selection";

/**
 * Os dois defeitos que a pessoa sentia em toda conversa, e que só apareceram
 * quando esta lógica saiu de dentro do hook.
 */

const batch = { title: "Nubank" };
const breakdown = {
  kind: "breakdown",
  title: "Onde foi o dinheiro",
  rows: [{ label: "Mercado", amount: 12_500, transactionIds: ["txn_1"] }],
} as unknown as View;
const conference = {
  kind: "checksum",
  title: "Conferência",
  batchId: "bat_1",
  declaredTotal: 100,
  extractedTotal: 100,
  difference: 0,
  result: "match",
  rows: [],
} as unknown as View;

const empty: ReadonlyMap<string, MessageArtifact> = new Map();

describe("resolveActive", () => {
  it("uma pergunta nova vence a fatura que espera decisão", () => {
    // O caso diário: a pessoa sobe a fatura, não decide, e pergunta outra
    // coisa. O painel mostrava a conferência antiga e o breakdown novo só era
    // alcançável pelo link da mensagem.
    const active = resolveActive({ type: "latest" }, {
      batch,
      presented: breakdown,
      messageArtifacts: empty,
      batchId: "bat_1",
    });

    assert.equal(active?.kind, "view");
  });

  it("a conferência DAQUELA fatura mantém o cartão, que é quem tem os botões", () => {
    const active = resolveActive({ type: "latest" }, {
      batch,
      presented: conference,
      messageArtifacts: empty,
      batchId: "bat_1",
    });

    assert.equal(active?.kind, "batch");
  });

  it("conferência de OUTRA fatura não sequestra o cartão da atual", () => {
    const other = { ...conference, batchId: "bat_9" } as unknown as View;
    const active = resolveActive({ type: "latest" }, {
      batch,
      presented: other,
      messageArtifacts: empty,
      batchId: "bat_1",
    });

    assert.equal(active?.kind, "view");
  });

  it("sem painel no turno, a fatura pendente continua na coluna", () => {
    const active = resolveActive({ type: "latest" }, {
      batch,
      presented: null,
      messageArtifacts: empty,
      batchId: "bat_1",
    });

    assert.equal(active?.kind, "batch");
  });

  it("o link de uma resposta antiga abre o painel daquela resposta", () => {
    const map = new Map<string, MessageArtifact>([["m1", { kind: "view", view: breakdown }]]);
    const active = resolveActive({ type: "view", id: "m1" }, {
      batch,
      presented: conference,
      messageArtifacts: map,
      batchId: "bat_1",
    });

    assert.equal(active?.kind, "view");
    assert.equal(active?.kind === "view" ? active.view.title : null, "Onde foi o dinheiro");
  });

  it("alvo que sumiu fecha a coluna em vez de mostrar outra coisa", () => {
    assert.equal(
      resolveActive({ type: "view", id: "sumiu" }, {
        batch,
        presented: null,
        messageArtifacts: empty,
        batchId: null,
      }),
      null,
    );
    assert.equal(
      resolveActive({ type: "batch" }, {
        batch: null,
        presented: breakdown,
        messageArtifacts: empty,
        batchId: null,
      }),
      null,
    );
  });
});

describe("artifactKey", () => {
  it("muda quando nasce um painel, mesmo com uma fatura pendente", () => {
    const antes = artifactKey({
      batchId: "bat_1",
      batchTitle: "Nubank",
      hasPresented: false,
      turnId: "t1",
    });
    const depois = artifactKey({
      batchId: "bat_1",
      batchTitle: "Nubank",
      hasPresented: true,
      turnId: "t2",
    });

    assert.notEqual(antes, depois);
  });

  it("a mesma pergunta feita de novo reabre a coluna", () => {
    // A chave era o JSON do painel: dois painéis idênticos produziam a mesma
    // chave, e quem tinha fechado a coluna não a via voltar.
    assert.notEqual(
      artifactKey({ batchId: null, batchTitle: null, hasPresented: true, turnId: "t1" }),
      artifactKey({ batchId: null, batchTitle: null, hasPresented: true, turnId: "t2" }),
    );
  });

  it("sem artefato nenhum não há o que reabrir", () => {
    assert.equal(
      artifactKey({ batchId: null, batchTitle: null, hasPresented: false, turnId: "t1" }),
      null,
    );
  });
});
