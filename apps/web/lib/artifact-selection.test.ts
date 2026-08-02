import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { View } from "@clara-financas/views";

import {
  artifactKey,
  resolveActive,
  shouldAutoOpen,
  type MessageArtifact,
} from "./artifact-selection";

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
      presented: [breakdown],
      messageArtifacts: empty,
      batchId: "bat_1",
    });

    assert.equal(active?.kind, "view");
  });

  it("a conferência DAQUELA fatura mantém o cartão, que é quem tem os botões", () => {
    const active = resolveActive({ type: "latest" }, {
      batch,
      presented: [conference],
      messageArtifacts: empty,
      batchId: "bat_1",
    });

    assert.equal(active?.kind, "batch");
  });

  it("conferência de OUTRA fatura não sequestra o cartão da atual", () => {
    const other = { ...conference, batchId: "bat_9" } as unknown as View;
    const active = resolveActive({ type: "latest" }, {
      batch,
      presented: [other],
      messageArtifacts: empty,
      batchId: "bat_1",
    });

    assert.equal(active?.kind, "view");
  });

  it("sem painel no turno, a fatura pendente continua na coluna", () => {
    const active = resolveActive({ type: "latest" }, {
      batch,
      presented: [],
      messageArtifacts: empty,
      batchId: "bat_1",
    });

    assert.equal(active?.kind, "batch");
  });

  it("o link de uma resposta antiga abre o painel daquela resposta", () => {
    const map = new Map<string, MessageArtifact>([["m1", { kind: "view", views: [breakdown] }]]);
    const active = resolveActive({ type: "view", id: "m1" }, {
      batch,
      presented: [conference],
      messageArtifacts: map,
      batchId: "bat_1",
    });

    assert.equal(active?.kind, "view");
    assert.equal(active?.kind === "view" ? active.views.at(-1)?.title : null, "Onde foi o dinheiro");
  });

  it("dois painéis na mesma resposta chegam os dois à coluna", () => {
    // O primeiro sumia sem sinal: o texto da Clara falava de dois painéis e
    // só um existia.
    const active = resolveActive({ type: "latest" }, {
      batch: null,
      presented: [conference, breakdown],
      messageArtifacts: empty,
      batchId: null,
    });

    assert.equal(active?.kind, "view");
    assert.equal(active?.kind === "view" ? active.views.length : 0, 2);
  });

  it("a conferência com OUTRO painel junto não segura o cartão", () => {
    // Só a conferência sozinha significa "estou te mostrando a fatura". Com
    // mais alguma coisa, a pessoa pediu outra coisa — e é isso que ela espera.
    const active = resolveActive({ type: "latest" }, {
      batch,
      presented: [conference, breakdown],
      messageArtifacts: empty,
      batchId: "bat_1",
    });

    assert.equal(active?.kind, "view");
  });

  it("a conferência de uma fatura decidida abre pelo link, sem botões", () => {
    const history = { title: "Nubank", primaryAction: undefined } as unknown;
    const map = new Map<string, MessageArtifact>([
      ["m1", { kind: "batchHistory", data: history }],
    ]);
    const active = resolveActive({ type: "view", id: "m1" }, {
      batch: null,
      presented: [],
      messageArtifacts: map,
      batchId: null,
    });

    assert.equal(active?.kind, "batch");
    assert.equal(active?.kind === "batch" ? active.data : null, history);
  });

  it("alvo que sumiu fecha a coluna em vez de mostrar outra coisa", () => {
    assert.equal(
      resolveActive({ type: "view", id: "sumiu" }, {
        batch,
        presented: [],
        messageArtifacts: empty,
        batchId: null,
      }),
      null,
    );
    assert.equal(
      resolveActive({ type: "batch" }, {
        batch: null,
        presented: [breakdown],
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

describe("abrir a coluna sozinha", () => {
  it("abrir uma conversa antiga NÃO escancara o painel", () => {
    // O sintoma: a pessoa clica numa conversa para reler o que foi conversado
    // e recebe meia tela ocupada por um painel que ela não pediu. Os eventos
    // retomados já trazem os `present_*` daquela conversa, então a chave nasce
    // preenchida e o efeito disparava na montagem.
    const retomada = artifactKey({
      batchId: null,
      batchTitle: null,
      hasPresented: true,
      turnId: "t9",
    });

    assert.equal(shouldAutoOpen({ openKey: retomada, mountKey: retomada, autoOpen: true }), false);
  });

  it("um artefato produzido AGORA abre a coluna", () => {
    const naMontagem = artifactKey({
      batchId: null,
      batchTitle: null,
      hasPresented: true,
      turnId: "t9",
    });
    const perguntaNova = artifactKey({
      batchId: null,
      batchTitle: null,
      hasPresented: true,
      turnId: "t10",
    });

    assert.equal(
      shouldAutoOpen({ openKey: perguntaNova, mountKey: naMontagem, autoOpen: true }),
      true,
    );
  });

  it("conversa nova: o primeiro artefato abre a coluna", () => {
    // Montou sem artefato nenhum (`null`); o primeiro painel é novidade.
    const primeiro = artifactKey({
      batchId: null,
      batchTitle: null,
      hasPresented: true,
      turnId: "t1",
    });

    assert.equal(shouldAutoOpen({ openKey: primeiro, mountKey: null, autoOpen: true }), true);
  });

  it("no celular a coluna nunca abre sozinha", () => {
    // Lá o artefato é uma modal em tela cheia: abri-la sozinha cobre a conversa.
    assert.equal(
      shouldAutoOpen({ openKey: "view:t2", mountKey: "view:t1", autoOpen: false }),
      false,
    );
  });

  it("antes da primeira renderização assentar, não abre", () => {
    assert.equal(
      shouldAutoOpen({ openKey: "view:t1", mountKey: undefined, autoOpen: true }),
      false,
    );
  });
});