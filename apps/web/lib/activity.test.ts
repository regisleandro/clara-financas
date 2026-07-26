import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveActivity, inflightTurnId, TOOL_FALLBACK_LABEL, TOOL_LABEL } from "./activity";

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

  /**
   * Um pedido que a tool recusa APONTANDO a saída não é uma quebra. Pintar de
   * vermelho o que o sistema resolveu ensina a pessoa a desconfiar do trace.
   */
  it("erro recuperável vira aviso, não falha, e carrega a causa", () => {
    const activity = deriveActivity(
      turn([
        requested("c1", "recategorize_transactions"),
        {
          type: "action.result",
          data: {
            result: {
              callId: "c1",
              output: {
                error: {
                  code: "categoria_desconhecida",
                  message: 'Não existe categoria "pagamento-de-fatura".',
                  hint: "Proponha a criação com save_concept.",
                  retryable: true,
                },
              },
            },
          },
        },
      ]),
    );

    assert.equal(activity.steps[0]?.status, "warning");
    assert.equal(activity.steps[0]?.cause, 'Não existe categoria "pagamento-de-fatura".');
  });

  it("erro sem saída continua sendo falha, com a causa preservada", () => {
    const activity = deriveActivity(
      turn([
        requested("c1", "edit_proposed_batch"),
        {
          type: "action.result",
          data: {
            result: {
              callId: "c1",
              output: {
                error: {
                  code: "lote_ja_decidido",
                  message: "Esta fatura já foi registrada no razão.",
                  retryable: false,
                },
              },
            },
          },
        },
      ]),
    );

    assert.equal(activity.steps[0]?.status, "failed");
    assert.equal(activity.steps[0]?.cause, "Esta fatura já foi registrada no razão.");
  });

  it("o nome cru da ferramenta fica no passo, para diagnóstico", () => {
    const activity = deriveActivity(turn([requested("c1", "create_adjustment")]));

    assert.equal(activity.steps[0]?.toolName, "create_adjustment");
    // …e continua fora da tela: o rótulo é a frase em português.
    assert.equal(activity.steps[0]?.label, "Registrando o ajuste");
  });

  it("subagent.completed não reverte um passo que já falhou", () => {
    // A ordem de emissão decidia a cor: chegando por último, este evento
    // pintava de verde uma delegação que tinha falhado.
    const activity = deriveActivity(
      turn([
        { type: "subagent.called", data: { callId: "c1", name: "analyst" } },
        {
          type: "action.result",
          data: { status: "failed", result: { callId: "c1", output: {} } },
        },
        { type: "subagent.completed", data: { callId: "c1" } },
      ]),
    );

    assert.equal(activity.steps[0]?.status, "failed");
  });

  it("um turno que falha não deixa passo pendurado em verde", () => {
    const activity = deriveActivity(
      turn([
        requested("c1", "commit_batch"),
        { type: "turn.failed", data: { error: "A sessão expirou." } },
      ]),
    );

    assert.equal(activity.steps[0]?.status, "failed");
    assert.equal(activity.steps[0]?.cause, "A sessão expirou.");
  });

  /**
   * Um turno cancelado não fecha suas etapas: o que estava rodando não volta, e
   * um subagente cancelado nem emite `subagent.completed`. Ficava um ícone
   * pulsando para sempre num turno que a própria pessoa interrompeu.
   */
  it("um turno cancelado fecha as etapas em aviso, não em vermelho", () => {
    const activity = deriveActivity(
      turn([
        requested("c1", "propose_batch"),
        { type: "turn.cancelled", data: { turnId: "t1" } },
        { type: "session.waiting", data: {} },
      ]),
    );

    assert.equal(activity.steps[0]?.status, "warning");
    assert.equal(activity.steps[0]?.cause, "Interrompida a seu pedido.");
    assert.equal(activity.current, null);
  });

  it("o cancelamento não apaga a causa de uma etapa que já tinha falhado", () => {
    const activity = deriveActivity(
      turn([
        requested("c1", "commit_batch"),
        {
          type: "action.result",
          data: { result: { callId: "c1", output: { error: "lote não encontrado" } } },
        },
        { type: "turn.cancelled", data: { turnId: "t1" } },
      ]),
    );

    assert.equal(activity.steps[0]?.status, "failed");
    assert.equal(activity.steps[0]?.cause, "lote não encontrado");
  });
});

/**
 * O id do turno em voo é o que torna o botão "Parar" honesto: `session.cancel`
 * sem ele cancelaria o turno que estivesse ativo NA HORA em que o pedido
 * chegasse — inclusive um turno seguinte, que a pessoa nunca pediu para parar.
 */
describe("inflightTurnId", () => {
  it("devolve o turno aberto", () => {
    assert.equal(inflightTurnId(turn([requested("c1", "commit_batch")])), "t1");
  });

  it("turno postado e ainda sem eventos não tem id para cancelar", () => {
    // O status `submitted` do eve: o POST saiu, nada voltou. Cancelar aqui
    // seria um tiro no escuro; a UI prefere um botão inerte por um instante.
    assert.equal(inflightTurnId([]), null);
  });

  it("turno que assentou não é cancelável — em nenhuma das fronteiras", () => {
    for (const settled of [
      "turn.completed",
      "turn.failed",
      "turn.cancelled",
      "session.waiting",
      "session.completed",
      "session.failed",
    ]) {
      assert.equal(
        inflightTurnId([...turn([requested("c1", "commit_batch")]), { type: settled, data: {} }]),
        null,
        `${settled} deveria encerrar o turno`,
      );
    }
  });

  it("depois de um turno fechado, o id é o do turno NOVO", () => {
    const events = [
      ...turn([requested("c1", "commit_batch")]),
      { type: "session.waiting", data: {} },
      { type: "turn.started", data: { turnId: "t2" } },
    ];

    assert.equal(inflightTurnId(events), "t2");
  });

  it("turno sem id no evento não é cancelado às cegas", () => {
    assert.equal(inflightTurnId([{ type: "turn.started", data: {} }]), null);
  });
});
