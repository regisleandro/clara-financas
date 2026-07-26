import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findMessageView, findPresentedView } from "./stream";

/**
 * Estes testes cobrem exatamente os erros que a inferência anterior cometia em
 * uso real: manter o painel de uma pergunta antiga ao lado da resposta nova, e
 * desenhar painel quando a Clara não pediu nenhum.
 */

const view = (title: string) => ({
  kind: "metric",
  title,
  metric: { label: "Total", amount: 1000 },
  rows: [],
});

const requested = (input: unknown, toolName = "present_view") => ({
  type: "actions.requested",
  data: { actions: [{ callId: "c1", toolName, input }] },
});

describe("findPresentedView", () => {
  it("encontra o painel que a Clara mandou desenhar", () => {
    const found = findPresentedView([requested(view("Gastos de junho"))]);
    assert.equal(found?.title, "Gastos de junho");
  });

  it("turno novo apaga o painel do turno anterior", () => {
    const found = findPresentedView([
      requested(view("Pergunta antiga")),
      { type: "turn.started", data: {} },
      { type: "message.appended", data: {} },
    ]);
    assert.equal(found, null);
  });

  it("dentro do mesmo turno, a decisão mais recente vence", () => {
    const found = findPresentedView([
      requested(view("Primeira tentativa")),
      requested(view("Correção")),
    ]);
    assert.equal(found?.title, "Correção");
  });

  it("o painel sobrevive ao turno em que foi pedido", () => {
    const found = findPresentedView([
      { type: "turn.started", data: {} },
      requested(view("Gastos de junho")),
      { type: "message.appended", data: {} },
      { type: "turn.completed", data: {} },
    ]);
    assert.equal(found?.title, "Gastos de junho");
  });

  it("ignora chamadas de outras ferramentas", () => {
    const found = findPresentedView([requested(view("x"), "commit_batch")]);
    assert.equal(found, null);
  });

  it("payload inválido não vira painel e não quebra a leitura", () => {
    const found = findPresentedView([
      requested({ kind: "metric", title: "" }),
      requested(view("Válido")),
    ]);
    assert.equal(found?.title, "Válido");
  });

  it("um payload inválido não apaga o painel válido anterior", () => {
    const found = findPresentedView([
      requested(view("Válido")),
      requested({ kind: "inventado", title: "x" }),
    ]);
    assert.equal(found?.title, "Válido");
  });

  it("sem evento algum, não há painel", () => {
    assert.equal(findPresentedView([]), null);
  });

  it("aguenta evento malformado sem estourar", () => {
    const found = findPresentedView([
      null,
      "texto solto",
      { type: "actions.requested" },
      { type: "actions.requested", data: { actions: "não é lista" } },
      requested(view("Válido")),
    ]);
    assert.equal(found?.title, "Válido");
  });
});

const viewPart = (input: unknown, toolName = "present_view") => ({
  type: "dynamic-tool",
  toolName,
  input,
});

describe("findMessageView", () => {
  it("encontra o painel gravado na mensagem", () => {
    const found = findMessageView({
      id: "m1",
      role: "assistant",
      parts: [{ type: "text", text: "Aqui está" }, viewPart(view("Gastos de junho"))],
    });
    assert.equal(found?.title, "Gastos de junho");
  });

  it("mensagem sem painel não tem artefato", () => {
    const found = findMessageView({ id: "m1", role: "assistant", parts: [{ type: "text" }] });
    assert.equal(found, null);
  });

  it("ignora outras ferramentas gravadas na mensagem", () => {
    const found = findMessageView({ parts: [viewPart(view("x"), "commit_batch")] });
    assert.equal(found, null);
  });

  it("payload inválido não vira painel", () => {
    const found = findMessageView({ parts: [viewPart({ kind: "metric", title: "" })] });
    assert.equal(found, null);
  });

  it("dentro da mensagem, o último painel vence", () => {
    const found = findMessageView({
      parts: [viewPart(view("Primeiro")), viewPart(view("Correção"))],
    });
    assert.equal(found?.title, "Correção");
  });

  it("aguenta mensagem malformada sem estourar", () => {
    assert.equal(findMessageView(null), null);
    assert.equal(findMessageView({ parts: "não é lista" }), null);
    assert.equal(findMessageView({}), null);
  });
});
