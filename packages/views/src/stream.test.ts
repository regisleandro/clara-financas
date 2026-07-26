import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findMessageView, findMessageViews, findPresentedView, findPresentedViews } from "./stream";

/**
 * Estes testes cobrem exatamente os erros que a inferência anterior cometia em
 * uso real: manter o painel de uma pergunta antiga ao lado da resposta nova, e
 * desenhar painel quando a Clara não pediu nenhum.
 */

const view = (title: string) => ({
  kind: "metric",
  title,
  metric: { label: "Total", amount: 1000, transactionIds: ["t1"] },
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

  it("payload inválido dispara o callback com a descrição da falha", () => {
    // Antes o painel sumia em silêncio — sem log, sem fallback — e o sintoma
    // em produção era "o artefato às vezes não abre", indepurável.
    const invalid: Array<{ issues: string[]; callId?: string }> = [];
    const found = findPresentedView(
      [requested({ kind: "metric", title: "Total", metric: { label: "T", amount: 84.21 } })],
      (issues, callId) => invalid.push({ issues, callId }),
    );

    assert.equal(found, null);
    assert.equal(invalid.length, 1);
    assert.equal(invalid[0]?.callId, "c1");
    assert.ok(invalid[0]?.issues.some((issue) => issue.includes("metric.amount")));
  });

  it("payload válido não dispara o callback", () => {
    let calls = 0;
    findPresentedView([requested(view("Válido"))], () => {
      calls += 1;
    });
    assert.equal(calls, 0);
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

  it("payload inválido na mensagem também dispara o callback", () => {
    const invalid: string[][] = [];
    findMessageView(
      { parts: [viewPart({ kind: "metric", title: "" })] },
      (issues) => invalid.push(issues),
    );
    assert.equal(invalid.length, 1);
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

  it("os dois painéis de um turno chegam inteiros", () => {
    // `findPresentedView` guarda o último — é o que a coluna abre. Mas o
    // anterior existia e sumia sem sinal.
    const panel = (title: string) => ({
      kind: "metric",
      title,
      metric: { label: "Total", amount: 100, transactionIds: ["txn_1"] },
    });
    const events = [
      { type: "turn.started", data: { turnId: "t1" } },
      {
        type: "actions.requested",
        data: { actions: [{ callId: "c1", toolName: "present_view", input: panel("Proposta") }] },
      },
      {
        type: "actions.requested",
        data: { actions: [{ callId: "c2", toolName: "present_view", input: panel("Resultado") }] },
      },
    ];

    assert.deepEqual(
      findPresentedViews(events).map((view) => view.title),
      ["Proposta", "Resultado"],
    );
    assert.equal(findPresentedView(events)?.title, "Resultado");
  });

  it("os painéis de uma mensagem também vêm inteiros", () => {
    const part = (title: string) => ({
      type: "dynamic-tool",
      toolName: "present_view",
      input: {
        kind: "metric",
        title,
        metric: { label: "Total", amount: 100, transactionIds: ["txn_1"] },
      },
    });
    const message = { parts: [part("Um"), part("Dois")] };

    assert.deepEqual(
      findMessageViews(message).map((view) => view.title),
      ["Um", "Dois"],
    );
    assert.equal(findMessageView(message)?.title, "Dois");
  });
});
