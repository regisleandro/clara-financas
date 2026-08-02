import {
  FinancialArtifactSchema,
  parseViewResult,
  type FinancialArtifact,
  type View,
} from "./index";

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
export const PRESENT_ANALYSIS_TOOL = "present_analysis";
export const PRESENT_CATEGORIZATION_TOOL = "present_categorization";
export const PRESENT_FINANCIAL_ARTIFACT_TOOL = "present_financial_artifact";

const OUTPUT_VIEW_TOOLS = new Set([PRESENT_ANALYSIS_TOOL, PRESENT_CATEGORIZATION_TOOL]);

/**
 * Chamado quando um payload COMPLETO de `present_view` falha no schema.
 *
 * Sem isto, o painel sumia em silêncio — sem log, sem fallback — e o sintoma
 * em produção era "o artefato às vezes não abre", indepurável. O callback é o
 * ponto único onde o consumidor pluga log ou telemetria; ele nunca é chamado
 * para input parcial de streaming (só lemos eventos com o input inteiro).
 */
export type OnInvalidView = (issues: string[], callId?: string) => void;

/**
 * O último painel do turno corrente, ou null.
 *
 * A chamada só vira painel depois de um `action.result` bem-sucedido. Input
 * solicitado não é confirmação de que a tool executou.
 *
 * "Último" porque ela pode corrigir o rumo dentro do mesmo turno. "Do turno
 * corrente" porque painel de pergunta antiga ao lado de resposta nova sugere
 * que aqueles números são desta resposta — erro que ninguém percebe cometer.
 */
export function findPresentedView(
  events: readonly unknown[],
  onInvalid?: OnInvalidView,
): View | null {
  return findPresentedViews(events, onInvalid).at(-1) ?? null;
}

/**
 * TODOS os painéis do turno corrente, na ordem em que foram pedidos.
 *
 * A leitura antiga guardava só o último, e o anterior sumia sem sinal. Duas
 * respostas legítimas do produto caem nesse caso: a proposta do que vai mudar
 * seguida do resultado, e a conferência seguida da composição. O texto da
 * Clara falava dos dois painéis e só um existia — a pessoa procurava o outro
 * e concluía que a interface tinha engolido a resposta.
 *
 * Continua valendo "um painel por resposta" como orientação ao modelo; o que
 * muda é que desobedecer deixa de custar informação.
 */
export function findPresentedViews(
  events: readonly unknown[],
  onInvalid?: OnInvalidView,
): View[] {
  let views: View[] = [];
  let requested = new Map<string, { toolName: string; input: unknown }>();

  for (const raw of events) {
    const event = asRecord(raw);
    const type = asString(event?.type);

    // Turno novo zera: se a Clara não mandar desenhar nada desta vez, a tela
    // fica limpa em vez de manter o desenho anterior.
    if (type === "turn.started") {
      views = [];
      requested = new Map();
      continue;
    }

    if (type === "actions.requested") {
      const actions = asRecord(event?.data)?.actions;
      if (!Array.isArray(actions)) continue;
      for (const rawAction of actions) {
        const action = asRecord(rawAction);
        const callId = asString(action?.callId);
        const toolName = asString(action?.toolName);
        if (
          callId !== undefined &&
          toolName !== undefined &&
          (toolName === PRESENT_VIEW_TOOL || OUTPUT_VIEW_TOOLS.has(toolName))
        ) {
          requested.set(callId, { toolName, input: action?.input });
        }
      }
      continue;
    }

    if (type === "action.result") {
      const data = asRecord(event?.data);
      const result = asRecord(data?.result);
      const callId = asString(result?.callId);
      if (callId === undefined || !requested.has(callId)) continue;
      const output = asRecord(result?.output);
      if (data?.status === "failed" || output?.error !== undefined) {
        requested.delete(callId);
        continue;
      }
      const pending = requested.get(callId)!;
      for (const candidate of viewCandidates(pending, output)) {
        const parsed = parseViewResult(candidate);
        if (parsed.ok) views.push(parsed.view);
        else onInvalid?.(parsed.issues, callId);
      }
      requested.delete(callId);
    }
  }

  return views;
}

/**
 * Os painéis que UMA chamada produziu.
 *
 * `present_view` traz o painel no INPUT (é a coordenadora que o desenha);
 * `present_analysis` e `present_categorization` trazem no OUTPUT, porque o
 * painel veio de um artefato validado que o modelo nunca tocou.
 *
 * A lista existe porque uma resposta pode ter mais de um painel. `view`
 * singular continua sendo lido: artefato de sessão já persistida foi gravado
 * assim, e uma conversa retomada não pode perder o painel por causa da forma.
 */
function viewCandidates(
  pending: { toolName: string; input: unknown },
  output: Record<string, unknown> | undefined,
): unknown[] {
  if (pending.toolName === PRESENT_VIEW_TOOL) return [pending.input];
  const plural = output?.views;
  if (Array.isArray(plural)) return plural;
  return output?.view === undefined ? [] : [output.view];
}

/**
 * O painel que UMA mensagem específica mandou desenhar, ou null.
 *
 * `findPresentedView` lê o stream de eventos e responde "qual é o painel de
 * AGORA". Esta função lê as `parts` de uma mensagem já materializada e responde
 * "esta mensagem tem um painel associado" — é o que sustenta o link "Ver
 * artefato" que acompanha cada resposta, no celular e na web.
 *
 * O `present_view` fica gravado na mensagem como uma parte `dynamic-tool`.
 * Só projetamos a parte depois de uma saída bem-sucedida.
 */
export function findMessageView(message: unknown, onInvalid?: OnInvalidView): View | null {
  return findMessageViews(message, onInvalid).at(-1) ?? null;
}

/** Todos os painéis de UMA mensagem, na ordem em que ela os pediu. */
export function findMessageViews(message: unknown, onInvalid?: OnInvalidView): View[] {
  const parts = asRecord(message)?.parts;
  if (!Array.isArray(parts)) return [];

  const views: View[] = [];
  for (const raw of parts) {
    const part = asRecord(raw);
    const toolName = asString(part?.toolName);
    if (
      part?.type !== "dynamic-tool" ||
      toolName === undefined ||
      (toolName !== PRESENT_VIEW_TOOL && !OUTPUT_VIEW_TOOLS.has(toolName))
    ) {
      continue;
    }
    const output = asRecord(part.output);
    if (output === undefined || output.error !== undefined || output.presented === undefined) {
      continue;
    }
    // Parte materializada já tem o input completo — aqui falha de schema é
    // definitiva, nunca efeito de streaming pela metade.
    for (const candidate of viewCandidates({ toolName, input: part.input }, output)) {
      const parsed = parseViewResult(candidate);
      if (parsed.ok) views.push(parsed.view);
      else onInvalid?.(parsed.issues, asString(part.toolCallId));
    }
  }

  return views;
}

export type OnInvalidFinancialArtifact = (issues: string[], callId?: string) => void;

/** Artefatos ricos apresentados no turno corrente. */
export function findPresentedFinancialArtifacts(
  events: readonly unknown[],
  onInvalid?: OnInvalidFinancialArtifact,
): FinancialArtifact[] {
  let artifacts: FinancialArtifact[] = [];
  const requested = new Map<string, string>();

  for (const raw of events) {
    const event = asRecord(raw);
    const type = asString(event?.type);
    if (type === "turn.started") {
      artifacts = [];
      requested.clear();
      continue;
    }
    if (type === "actions.requested") {
      const actions = asRecord(event?.data)?.actions;
      if (!Array.isArray(actions)) continue;
      for (const rawAction of actions) {
        const action = asRecord(rawAction);
        const callId = asString(action?.callId);
        const toolName = asString(action?.toolName);
        if (callId !== undefined && toolName === PRESENT_FINANCIAL_ARTIFACT_TOOL) {
          requested.set(callId, toolName);
        }
      }
      continue;
    }
    if (type !== "action.result") continue;
    const data = asRecord(event?.data);
    const result = asRecord(data?.result);
    const callId = asString(result?.callId);
    if (callId === undefined || !requested.has(callId)) continue;
    const output = asRecord(result?.output);
    requested.delete(callId);
    if (data?.status === "failed" || output?.error !== undefined) continue;
    const parsed = FinancialArtifactSchema.safeParse(output?.artifact);
    if (parsed.success) artifacts.push(parsed.data);
    else onInvalid?.(parsed.error.issues.map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`), callId);
  }
  return artifacts;
}

/** Artefatos ricos associados a uma mensagem já materializada. */
export function findMessageFinancialArtifacts(
  message: unknown,
  onInvalid?: OnInvalidFinancialArtifact,
): FinancialArtifact[] {
  const parts = asRecord(message)?.parts;
  if (!Array.isArray(parts)) return [];
  const artifacts: FinancialArtifact[] = [];
  for (const raw of parts) {
    const part = asRecord(raw);
    if (part?.type !== "dynamic-tool" || part.toolName !== PRESENT_FINANCIAL_ARTIFACT_TOOL) continue;
    const output = asRecord(part.output);
    if (output === undefined || output.error !== undefined || output.artifact === undefined) continue;
    const parsed = FinancialArtifactSchema.safeParse(output.artifact);
    if (parsed.success) artifacts.push(parsed.data);
    else onInvalid?.(parsed.error.issues.map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`), asString(part.toolCallId));
  }
  return artifacts;
}
