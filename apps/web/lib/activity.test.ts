import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveActivity, TOOL_FALLBACK_LABEL, TOOL_LABEL } from "./activity";

/**
 * A trilha de execução é a única parte da conversa onde nomes internos podem
 * escapar para a tela. O produto é inteiramente em português, e um passo
 * escrito `apply_learned_rules` não é só feio: é o modelo mostrando sua
 * fiação para quem só queria saber o que está acontecendo com o dinheiro.
 *
 * Estes testes travam a garantia: NENHUM caminho do render produz um rótulo
 * que não seja uma frase em português.
 */

const turn = (steps: readonly unknown[]) => [
  { type: "turn.started", data: { turnId: "t1" } },
  ...steps,
];

const requested = (callId: string, toolName?: string) => ({
  type: "actions.requested",
  data: { actions: [{ callId, ...(toolName === undefined ? {} : { toolName }) }] },
});

describe("deriveActivity", () => {
  it("traduz a ferramenta conhecida para o que a pessoa entende", () => {
    const activity = deriveActivity(turn([requested("c1", "commit_batch")]));

    assert.equal(activity.steps[0]?.label, "Registrando no razão");
  });

  it("uma ferramenta sem rótulo NÃO vira identificador em inglês na tela", () => {
    // O caso real: o harness ganha uma tool, ou nasce uma nossa, e ninguém
    // lembra de atualizar o mapa. O custo disso tem que ser perder precisão,
    // nunca expor `some_new_tool` a quem usa.
    const activity = deriveActivity(turn([requested("c1", "some_new_tool")]));

    assert.equal(activity.steps[0]?.label, TOOL_FALLBACK_LABEL);
    assert.ok(!activity.steps[0]?.label.includes("_"));
  });

  it("um subagente desconhecido também cai numa frase, não no nome", () => {
    const activity = deriveActivity(
      turn([{ type: "subagent.called", data: { callId: "c1", name: "auditor" } }]),
    );

    assert.ok(activity.steps[0]?.label !== undefined);
    assert.ok(!activity.steps[0].label.includes("auditor"));
  });

  it("todo rótulo do mapa está em português — nenhum identificador cru", () => {
    for (const [tool, label] of Object.entries(TOOL_LABEL)) {
      assert.ok(!label.includes("_"), `${tool} tem underline no rótulo: ${label}`);
      assert.notEqual(label, tool);
    }
  });

  it("turno novo zera a trilha — a pessoa olha o agora, não o histórico", () => {
    const activity = deriveActivity([
      ...turn([requested("c1", "commit_batch")]),
      { type: "turn.started", data: { turnId: "t2" } },
      requested("c2", "list_commitments"),
    ]);

    assert.equal(activity.steps.length, 1);
    assert.equal(activity.steps[0]?.label, "Olhando os próximos vencimentos");
    assert.equal(activity.turnId, "t2");
  });

  it("chamada sem toolName é subagente e não vira passo anônimo", () => {
    const activity = deriveActivity(turn([requested("c1")]));

    assert.equal(activity.steps.length, 0);
  });

  it("resultado com erro marca o passo como falho", () => {
    const activity = deriveActivity(
      turn([
        requested("c1", "commit_batch"),
        {
          type: "action.result",
          data: { result: { callId: "c1", output: { error: "lote não encontrado" } } },
        },
      ]),
    );

    assert.equal(activity.steps[0]?.status, "failed");
  });
});
