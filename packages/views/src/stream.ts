import { parseView, type View } from "./index";

/**
 * Lê do stream do eve o painel que a Clara mandou desenhar.
 *
 * Vive no pacote do contrato, e não no frontend, porque "como o painel viaja"
 * é parte do contrato tanto quanto "que formas existem". E aqui é código puro,
 * então dá para testar o que a inferência anterior errava — que era justamente
 * o que ninguém conseguia testar quando morava dentro de um componente.
 *
 * Formato confirmado contra o agente rodando (v0.27.6):
 *   actions.requested → { actions: [{ callId, toolName, input }] }
 */

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const PRESENT_VIEW_TOOL = "present_view";

/**
 * O último painel do turno corrente, ou null.
 *
 * Lê o INPUT da chamada, não o resultado: o painel aparece no instante em que
 * a Clara decide mostrá-lo, sem esperar a execução terminar.
 *
 * "Último" porque ela pode corrigir o rumo dentro do mesmo turno. "Do turno
 * corrente" porque painel de pergunta antiga ao lado de resposta nova sugere
 * que aqueles números são desta resposta — erro que ninguém percebe cometer.
 */
export function findPresentedView(events: readonly unknown[]): View | null {
  let latest: View | null = null;

  for (const raw of events) {
    const event = asRecord(raw);
    const type = asString(event?.type);

    // Turno novo zera: se a Clara não mandar desenhar nada desta vez, a tela
    // fica limpa em vez de manter o desenho anterior.
    if (type === "turn.started") {
      latest = null;
      continue;
    }

    if (type !== "actions.requested") continue;

    const actions = asRecord(event?.data)?.actions;
    if (!Array.isArray(actions)) continue;

    for (const rawAction of actions) {
      const action = asRecord(rawAction);
      if (asString(action?.toolName) !== PRESENT_VIEW_TOOL) continue;

      // Payload inválido não vira painel — e não derruba a conversa. O modelo
      // erra campo, e um erro de render custaria a resposta inteira.
      const view = parseView(action?.input);
      if (view !== null) latest = view;
    }
  }

  return latest;
}

/**
 * O painel que UMA mensagem específica mandou desenhar, ou null.
 *
 * `findPresentedView` lê o stream de eventos e responde "qual é o painel de
 * AGORA". Esta função lê as `parts` de uma mensagem já materializada e responde
 * "esta mensagem tem um painel associado" — é o que sustenta o link "Ver
 * artefato" que acompanha cada resposta, no celular e na web.
 *
 * O `present_view` fica gravado na mensagem como uma parte `dynamic-tool`, do
 * mesmo jeito que `propose_batch` (ver `hitl.ts`). Lê o `input` da chamada, não
 * o resultado: o painel é o que a Clara mandou desenhar, e `present_view` não
 * devolve saída de conteúdo.
 */
export function findMessageView(message: unknown): View | null {
  const parts = asRecord(message)?.parts;
  if (!Array.isArray(parts)) return null;

  // Uma resposta pode corrigir o rumo e pedir dois painéis; vale o último.
  let latest: View | null = null;
  for (const raw of parts) {
    const part = asRecord(raw);
    if (part?.type !== "dynamic-tool" || asString(part.toolName) !== PRESENT_VIEW_TOOL) {
      continue;
    }
    const view = parseView(part.input);
    if (view !== null) latest = view;
  }

  return latest;
}
