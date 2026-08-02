/**
 * Estado de execução, derivado do stream do eve.
 *
 * Formatos confirmados contra o agente rodando (v0.27.6), não supostos:
 *
 *   actions.requested  → { actions: [{ callId, toolName?, input }] }
 *   action.result      → { result: { callId, toolName?, kind, output }, status }
 *   subagent.called    → { callId, name, toolName, childSessionId }
 *   subagent.completed → { callId, output }
 *   message.appended   → texto chegando
 *   step.started/completed, turn.started/completed, session.waiting
 *   turn.cancelled     → { turnId } (cancelamento pedido pela pessoa)
 *
 * Duas particularidades que moldam o que dá para mostrar:
 *
 * 1. Numa chamada de subagente, `actions.requested` NÃO traz o nome — ele vem
 *    em `subagent.called`. Por isso a delegação é lida daquele evento.
 * 2. As tools internas de um subagente rodam na sessão FILHA e não aparecem
 *    neste stream. Dá para dizer "o analista está trabalhando", não o que ele
 *    chamou por dentro. A UI não deve fingir que sabe.
 */

export type ActivityIcon =
  | "brain"
  | "pen"
  | "document"
  | "calculator"
  | "search"
  | "ledger"
  | "calendar"
  | "tags"
  | "save";

export type ActivityStep = {
  id: string;
  kind: "tool" | "subagent" | "thinking" | "writing";
  label: string;
  detail?: string;
  icon: ActivityIcon;
  /**
   * `warning` é o estado que faltava, e a falta custava caro: um pedido que a
   * tool recusa APONTANDO o caminho (categoria que não existe, alcance que
   * mudou, lote já decidido) é o sistema funcionando, e aparecia na tela como
   * etapa quebrada. Vermelho é para o que não tem saída.
   */
  status: "running" | "done" | "failed" | "warning";
  /**
   * O nome cru da tool. Não vai para a tela — vai para o diagnóstico. Sem ele
   * era impossível saber, olhando uma sessão, QUAL ferramenta falhou: o rótulo
   * traduzido é ambíguo de propósito.
   */
  toolName?: string;
  /**
   * Por que falhou, em português. A causa chegava no evento e era descartada:
   * a interface lia `output.error` como booleano e jogava fora a mensagem, o
   * que tornava a falha impossível de explicar para quem estava olhando.
   */
  cause?: string;
};

export type Activity = {
  steps: ActivityStep[];
  /** O que está acontecendo agora, ou null quando o turno acabou. */
  current: ActivityStep | null;
  /** Turno corrente. Serve de chave para descartar artefato de rodada antiga. */
  turnId: string;
};

/**
 * Nomes de tool → o que a pessoa entende que está acontecendo.
 *
 * O mapa cobre TODAS as tools do coordenador (as de subagente rodam na sessão
 * filha e nunca chegam aqui, exceto `read_pdf_pages` que fica documentada por
 * garantia).
 *
 * O que falta cai em `TOOL_FALLBACK_LABEL`, e não no nome cru: uma tool nova —
 * do harness ou nossa — chegava à tela como `apply_learned_rules`, em inglês e
 * com underline, no meio de um produto inteiramente em português. O mapa é a
 * primeira linha; o fallback é o que garante que esquecer de atualizá-lo custe
 * precisão, não um identificador exposto a quem usa.
 */
export const TOOL_LABEL: Record<string, string> = {
  read_concept: "Consultando o que já foi aprendido",
  propose_batch: "Conferindo a soma com o total da fatura",
  edit_proposed_batch: "Aplicando as correções e reconferindo",
  commit_batch: "Registrando no razão",
  save_concept: "Guardando o aprendizado",
  save_commitment: "Agendando o lembrete",
  list_commitments: "Olhando os próximos vencimentos",
  list_invoices: "Consultando o histórico de faturas",
  resolve_invoice_reference: "Localizando a fatura certa",
  recategorize_transactions: "Recategorizando lançamentos",
  apply_learned_rules: "Aplicando as regras aprendidas",
  present_view: "Montando o painel",
  present_analysis: "Abrindo a análise validada",
  present_categorization: "Abrindo as propostas de categoria",
  read_pdf_pages: "Lendo as páginas do documento",
  ask_question: "Aguardando sua resposta",
  read_batch: "Abrindo a fatura",
  create_adjustment: "Registrando o ajuste",
  prepare_invoice_resolution: "Calculando o ajuste seguro",
  apply_invoice_resolution: "Aplicando e reconferindo o ajuste",
  prepare_batch_registration: "Preparando o registro",
  reject_batch: "Descartando a fatura",
  mark_reviewed: "Marcando como revisado",
  name_issuer: "Nomeando a operadora",
  list_review_queue: "Olhando o que falta revisar",
  propose_batch_from_extraction: "Montando o rascunho a partir da leitura",
  list_documents: "Listando os documentos enviados",
  read_reclassifications: "Consultando o histórico de mudanças",
  read_concept_history: "Consultando as versões do aprendizado",
  deactivate_commitment: "Desativando o lembrete",
  save_extraction: "Guardando a leitura do documento",
  read_tool_events: "Consultando o registro de execução",
  list_notifications: "Olhando os avisos já enviados",
  set_proactivity: "Ajustando os avisos automáticos",
};

/** O que se diz de uma ferramenta que ainda não tem rótulo próprio. */
export const TOOL_FALLBACK_LABEL = "Consultando os dados";

const SUBAGENT_LABEL: Record<string, string> = {
  extractor: "Lendo o documento",
  analyst: "Conferindo os valores no razão",
  categorizer: "Organizando as categorias",
};

const SUBAGENT_DETAIL: Record<string, string> = {
  extractor: "A leitura ainda será conferida antes de qualquer registro",
  analyst: "Os cálculos usam os lançamentos registrados",
  categorizer: "As sugestões não alteram nada sem sua decisão",
};

/** Ícone por ferramenta: o desenho diz o que está acontecendo antes do texto. */
export const TOOL_ICON: Record<string, ActivityIcon> = {
  read_concept: "search",
  propose_batch: "calculator",
  edit_proposed_batch: "calculator",
  commit_batch: "ledger",
  save_concept: "save",
  save_commitment: "calendar",
  list_commitments: "calendar",
  list_invoices: "document",
  resolve_invoice_reference: "search",
  recategorize_transactions: "tags",
  apply_learned_rules: "tags",
  present_view: "ledger",
  present_analysis: "ledger",
  present_categorization: "tags",
  read_pdf_pages: "document",
  ask_question: "brain",
  read_batch: "document",
  create_adjustment: "ledger",
  prepare_invoice_resolution: "search",
  apply_invoice_resolution: "ledger",
  prepare_batch_registration: "search",
  reject_batch: "ledger",
  mark_reviewed: "save",
  name_issuer: "tags",
  list_review_queue: "search",
  propose_batch_from_extraction: "calculator",
  list_documents: "document",
  read_reclassifications: "search",
  read_concept_history: "search",
  deactivate_commitment: "calendar",
  save_extraction: "save",
  read_tool_events: "search",
  list_notifications: "calendar",
  set_proactivity: "calendar",
};

const SUBAGENT_ICON: Record<string, ActivityIcon> = {
  extractor: "document",
  analyst: "calculator",
  categorizer: "tags",
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** Eventos que assentam o turno: depois deles não há mais o que cancelar. */
const TURN_SETTLED = new Set([
  "turn.completed",
  "turn.failed",
  "turn.cancelled",
  "session.waiting",
  "session.completed",
  "session.failed",
]);

/**
 * O turno EM VOO, ou null quando nenhum está rodando.
 *
 * É o que o botão "Parar" precisa. Cancelar de verdade é uma operação de
 * sessão + turno (`session.cancel({ turnId })`), e o id só existe depois de
 * observar o `turn.started` daquele turno — é ele que faz um clique atrasado
 * ser consumido como no-op no servidor em vez de matar o turno seguinte.
 *
 * Não reaproveita o `turnId` de `deriveActivity`: aquele SOBREVIVE ao fim do
 * turno de propósito (é chave de artefato do painel), e cancelar com ele
 * mandaria um pedido em nome de um turno que já assentou. Enquanto o status é
 * `submitted` — turno postado, nenhum evento de volta — isto devolve null, e
 * é a verdade: ainda não há id observado para cancelar.
 */
export function inflightTurnId(events: readonly unknown[]): string | null {
  let inflight: string | null = null;

  for (const raw of events) {
    const event = asRecord(raw);
    const type = asString(event?.type);
    if (type === undefined) continue;

    if (type === "turn.started") {
      inflight = asString(asRecord(event?.data)?.turnId) ?? null;
      continue;
    }
    if (TURN_SETTLED.has(type)) inflight = null;
  }

  return inflight;
}

export function deriveActivity(events: readonly unknown[]): Activity {
  const steps = new Map<string, ActivityStep>();
  let turnActive = false;
  let writing = false;
  let turnId = "";

  for (const raw of events) {
    const event = asRecord(raw);
    const type = asString(event?.type);
    const data = asRecord(event?.data);
    if (type === undefined) continue;

    switch (type) {
      case "turn.started": {
        // Um turno novo zera a trilha: a pessoa está olhando o que acontece
        // AGORA, não o histórico da sessão inteira.
        steps.clear();
        turnActive = true;
        writing = false;
        turnId = asString(data?.turnId) ?? `${turnId}+`;
        break;
      }

      case "actions.requested": {
        const actions = Array.isArray(data?.actions) ? data.actions : [];
        for (const item of actions) {
          const action = asRecord(item);
          const callId = asString(action?.callId);
          const toolName = asString(action?.toolName);
          // Sem toolName é chamada de subagente: o nome só vem depois, em
          // subagent.called. Registrar aqui produziria um passo anônimo.
          if (callId === undefined || toolName === undefined) continue;

          steps.set(callId, {
            id: callId,
            kind: "tool",
            label: TOOL_LABEL[toolName] ?? TOOL_FALLBACK_LABEL,
            icon: TOOL_ICON[toolName] ?? "search",
            status: "running",
            toolName,
          });
        }
        break;
      }

      case "subagent.called": {
        const callId = asString(data?.callId);
        const name = asString(data?.name) ?? asString(data?.toolName);
        if (callId === undefined || name === undefined) break;

        steps.set(callId, {
          id: callId,
          kind: "subagent",
          label: SUBAGENT_LABEL[name] ?? "Consultando os dados",
          detail: SUBAGENT_DETAIL[name],
          icon: SUBAGENT_ICON[name] ?? "brain",
          status: "running",
        });
        break;
      }

      case "subagent.completed": {
        const callId = asString(data?.callId);
        const step = callId === undefined ? undefined : steps.get(callId);
        if (step === undefined) break;
        // NÃO sobrescreve uma falha já registrada. Este evento marcava `done`
        // incondicionalmente, e a ordem de emissão decidia a cor: chegando
        // depois do `action.result`, um subagente que falhou voltava a verde.
        if (step.status === "failed" || step.status === "warning") break;
        steps.set(step.id, { ...step, status: "done" });
        break;
      }

      case "action.result": {
        const result = asRecord(data?.result);
        const callId = asString(result?.callId);
        const step = callId === undefined ? undefined : steps.get(callId);
        if (!step) break;

        const output = asRecord(result?.output);
        const error = output?.error;
        const structured = asRecord(error);
        // Erro estruturado (`{ code, message, retryable }`) traz a causa e diz
        // se havia saída. Erro em string é o formato antigo: sem código, e
        // tratado como quebra por não ter como afirmar o contrário.
        const cause = structured === undefined ? asString(error) : asString(structured.message);
        const retryable = structured?.retryable === true;
        const crashed = data?.status === "failed";
        const status =
          crashed || (error !== undefined && !retryable)
            ? ("failed" as const)
            : error !== undefined
              ? ("warning" as const)
              : ("done" as const);

        steps.set(step.id, { ...step, status, ...(cause !== undefined ? { cause } : {}) });
        break;
      }

      case "message.appended": {
        writing = true;
        break;
      }

      case "turn.failed": {
        // Um turno pode falhar sem que nenhuma tool tenha falhado — erro de
        // transporte, contexto estourado, schema recusado na saída de um
        // subagente. Sem marcar nada, o trace desenhava check verde e o
        // título "Como cheguei a esta resposta" para um turno que morreu.
        for (const step of steps.values()) {
          if (step.status === "running") {
            steps.set(step.id, {
              ...step,
              status: "failed",
              cause: step.cause ?? asString(data?.error) ?? "O turno terminou antes desta etapa.",
            });
          }
        }
        turnActive = false;
        writing = false;
        break;
      }

      case "turn.cancelled": {
        // Cancelar deixa etapas penduradas: o que estava rodando não volta, e
        // um subagente cancelado NÃO emite `subagent.completed` no pai. Sem
        // fechar aqui, a trilha ficava com ícone pulsando para sempre num
        // turno que a própria pessoa interrompeu. Âmbar, não vermelho: parar
        // por escolha não é o sistema quebrando.
        for (const step of steps.values()) {
          if (step.status === "running") {
            steps.set(step.id, {
              ...step,
              status: "warning",
              cause: step.cause ?? "Interrompida a seu pedido.",
            });
          }
        }
        turnActive = false;
        writing = false;
        break;
      }

      case "turn.completed":
      case "session.waiting": {
        turnActive = false;
        writing = false;
        break;
      }
    }
  }

  const ordered = [...steps.values()];
  const running = ordered.find((step) => step.status === "running");

  let current: ActivityStep | null = null;
  if (running !== undefined) current = running;
  else if (turnActive && writing) {
    current = {
      id: "writing",
      kind: "writing",
      label: "Escrevendo a resposta",
      icon: "pen",
      status: "running",
    };
  } else if (turnActive) {
    current = { id: "thinking", kind: "thinking", label: "Pensando", icon: "brain", status: "running" };
  }

  return { steps: ordered, current, turnId };
}
