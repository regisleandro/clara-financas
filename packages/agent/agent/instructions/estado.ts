import { defineDynamic, defineInstructions } from "eve/instructions";

import { loadSnapshot, renderSnapshot } from "../lib/snapshot";
import { requireSessionCaller } from "../lib/tenant";

/**
 * O estado do razão entra no contexto ANTES da primeira pergunta.
 *
 * Por que instruções dinâmicas e não uma ferramenta que a Clara chama: uma
 * ferramenta depende de ela lembrar de chamá-la, e o custo do esquecimento
 * recai justamente sobre o caso mais comum — a pessoa abre a conversa e
 * pergunta algo sobre o que já enviou. Aqui não há o que lembrar.
 *
 * Resolve em `turn.started`, não em `session.started`: dentro da MESMA
 * conversa a pessoa aprova uma fatura, e o turno seguinte precisa enxergar o
 * razão depois daquela aprovação. Preso em `session.started`, o contexto
 * envelheceria e a Clara passaria a conversa inteira negando o que ela mesma
 * acabou de registrar.
 *
 * Falha fechada: sem inquilino autenticado não injeta nada. Um snapshot é
 * dado financeiro de alguém, e degradar para "sem contexto" é a única queda
 * aceitável.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      let tenantId: string;
      let sessionId: string;
      try {
        ({ tenantId, sessionId } = requireSessionCaller(ctx));
      } catch {
        return null;
      }

      const snapshot = await loadSnapshot(tenantId, sessionId);
      return defineInstructions({ markdown: renderSnapshot(snapshot) });
    },
  },
});
