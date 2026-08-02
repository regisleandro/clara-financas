import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mensagemDeErro } from "./agent-error";

describe("a mensagem de erro que a pessoa lê", () => {
  it("traduz a causa, não as palavras", () => {
    // O que chegava à tela era do eve: em inglês, escrito para depurar.
    assert.match(
      mensagemDeErro("Session does not belong to this user."),
      /expirou no servidor/i,
    );
    assert.match(mensagemDeErro("TypeError: fetch failed"), /conexão/i);
  });

  it("diz o que a causa significa PARA A CONVERSA", () => {
    // "context length exceeded" não ajuda ninguém; "começar uma nova resolve" sim.
    assert.match(mensagemDeErro("maximum context length exceeded"), /começar uma nova/i);
  });

  it("mensagem desconhecida passa inteira, sem inventar causa", () => {
    /*
     * Errar dizendo "a conexão caiu" quando o problema era outro manda a
     * pessoa procurar no lugar errado. Um texto estranho em inglês é pior que
     * um bom texto em português, e melhor que um texto em português errado.
     */
    const estranho = "Upstream provider returned 502 from region gru1";
    assert.equal(mensagemDeErro(estranho), estranho);
  });

  it("erro vazio ainda diz alguma coisa", () => {
    assert.match(mensagemDeErro("   "), /não conseguiu responder/i);
  });
});
