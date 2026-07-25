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
  status: "running" | "done" | "failed";
};

export type Activity = {
  steps: ActivityStep[];
  /** O que está acontecendo agora, ou null quando o turno acabou. */
  current: ActivityStep | null;
};

/** Nomes de tool → o que a pessoa entende que está acontecendo. */
const TOOL_LABEL: Record<string, string> = {
  read_concept: "Consultando o que já foi aprendido",
  propose_batch: "Conferindo a soma com o total da fatura",
  edit_proposed_batch: "Aplicando as correções e reconferindo",
  commit_batch: "Registrando no razão",
  save_concept: "Guardando o aprendizado",
  save_commitment: "Agendando o lembrete",
  list_commitments: "Olhando os próximos vencimentos",
  recategorize_transactions: "Recategorizando lançamentos",
  export_bundle: "Exportando o conhecimento",
  read_pdf_pages: "Lendo as páginas do documento",
  ask_question: "Aguardando sua resposta",
};

const SUBAGENT_LABEL: Record<string, string> = {
  extractor: "Extrator lendo o documento",
  analyst: "Analista calculando sobre o razão",
};

const SUBAGENT_DETAIL: Record<string, string> = {
  extractor: "contexto isolado · sem acesso ao razão",
  analyst: "só leitura · todo número vem de ferramenta",
};

/** Ícone por ferramenta: o desenho diz o que está acontecendo antes do texto. */
const TOOL_ICON: Record<string, ActivityIcon> = {
  read_concept: "search",
  propose_batch: "calculator",
  edit_proposed_batch: "calculator",
  commit_batch: "ledger",
  save_concept: "save",
  save_commitment: "calendar",
  list_commitments: "calendar",
  recategorize_transactions: "tags",
  export_bundle: "save",
  read_pdf_pages: "document",
  ask_question: "brain",
};

const SUBAGENT_ICON: Record<string, ActivityIcon> = {
  extractor: "document",
  analyst: "calculator",
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export function deriveActivity(events: readonly unknown[]): Activity {
  const steps = new Map<string, ActivityStep>();
  let turnActive = false;
  let writing = false;

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
            label: TOOL_LABEL[toolName] ?? toolName,
            icon: TOOL_ICON[toolName] ?? "search",
            status: "running",
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
          label: SUBAGENT_LABEL[name] ?? `Delegando ao ${name}`,
          detail: SUBAGENT_DETAIL[name],
          icon: SUBAGENT_ICON[name] ?? "brain",
          status: "running",
        });
        break;
      }

      case "subagent.completed": {
        const callId = asString(data?.callId);
        const step = callId === undefined ? undefined : steps.get(callId);
        if (step) steps.set(step.id, { ...step, status: "done" });
        break;
      }

      case "action.result": {
        const result = asRecord(data?.result);
        const callId = asString(result?.callId);
        const step = callId === undefined ? undefined : steps.get(callId);
        if (!step) break;

        const output = asRecord(result?.output);
        const failed = data?.status === "failed" || output?.error !== undefined;
        steps.set(step.id, { ...step, status: failed ? "failed" : "done" });
        break;
      }

      case "message.appended": {
        writing = true;
        break;
      }

      case "turn.completed":
      case "turn.failed":
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

  return { steps: ordered, current };
}
