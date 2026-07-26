import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveAnswered } from "./answered-state";

/**
 * O caso que travava a conversa: dois gates EM SEQUÊNCIA no mesmo turno.
 *
 * O fluxo de aprendizado prescrito abre três cartões seguidos (recategorizar →
 * salvar regra → aplicar regra). Com o flag global antigo, responder o primeiro
 * escondia todos os seguintes — a sessão parava esperando uma decisão que a
 * tela não oferecia. Aqui está fixado que a resposta vale para UM pedido, e um
 * pedido novo volta a mostrar o cartão.
 */
describe("resolveAnswered", () => {
  const gate1 = { requestId: "req_1" };
  const gate2 = { requestId: "req_2" };

  it("sem pedido pendente, não há resposta a lembrar", () => {
    assert.equal(resolveAnswered(null, { requestId: "req_1", approved: true }), null);
  });

  it("pedido pendente ainda sem resposta mostra o cartão", () => {
    assert.equal(resolveAnswered(gate1, null), null);
  });

  it("respondido o pedido, cobre a janela entre o clique e o stream", () => {
    assert.equal(resolveAnswered(gate1, { requestId: "req_1", approved: true }), true);
    assert.equal(resolveAnswered(gate1, { requestId: "req_1", approved: false }), false);
  });

  it("um SEGUNDO gate no mesmo turno volta a mostrar o cartão", () => {
    // gate1 foi respondido; o agente abriu gate2 na sequência. A resposta
    // antiga não pode escondê-lo.
    assert.equal(resolveAnswered(gate2, { requestId: "req_1", approved: true }), null);
  });
});
