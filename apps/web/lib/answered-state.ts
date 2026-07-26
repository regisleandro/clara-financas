/**
 * O estado "já respondi este gate" — por PEDIDO, não por turno.
 *
 * A versão anterior era um `boolean | null` global no hook, que só voltava a
 * `null` quando a pessoa mandava uma mensagem nova. O fluxo prescrito de
 * aprendizado abre gates EM SEQUÊNCIA no mesmo turno (recategorizar → salvar
 * regra → aplicar regra): respondido o primeiro, o flag ficava `true`, e o
 * cartão do segundo gate nunca renderizava — a sessão parava em
 * `session.waiting` com zero controles na tela, e o único escape era recarregar
 * a página, sem que nada sugerisse isso.
 *
 * Aqui a resposta é amarrada ao `requestId` que ela respondeu. Um gate novo tem
 * id novo, então `resolveAnswered` volta a `null` sozinho e o cartão seguinte
 * aparece. Para o MESMO pedido, o valor cobre a janela entre o clique e o
 * evento de resposta chegar do stream — que é o que impede clique duplo.
 */
export type AnsweredRequest = {
  requestId: string;
  approved: boolean;
};

export function resolveAnswered(
  pending: { requestId: string } | null,
  answeredRequest: AnsweredRequest | null,
): boolean | null {
  if (pending === null || answeredRequest === null) return null;
  return answeredRequest.requestId === pending.requestId ? answeredRequest.approved : null;
}
