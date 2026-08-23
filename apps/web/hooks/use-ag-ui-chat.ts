"use client";

import { HttpAgent, type AgentSubscriber } from "@ag-ui/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { uploadDocument } from "@/lib/document-upload";
import { mensagemDeErro } from "@/lib/agent-error";

/**
 * A conversa com a Clara sobre AG-UI, porta de `use-clara-agent.ts` (Eve).
 *
 * Não é uma tradução 1:1: o protocolo do Eve e o do AG-UI resolvem aprovação
 * de jeitos diferentes, e forçar o contrato antigo aqui esconderia isso em vez
 * de lidar com isso. O que se preserva é o COMPORTAMENTO que importa —
 * escrever nunca trava, uma decisão pendente não esconde o resto da tela — não
 * a forma exata da API.
 *
 * O gate (`commit_batch`/`reject_batch`) é a ÚNICA pausa que existe neste
 * backend: `read_pdf_pages` pede senha de PDF como resposta em TEXTO normal
 * (decisão do backend — ver `clara/tools/read_pdf_pages.py`), não como um
 * segundo mecanismo de pausa. Por isso não há aqui um equivalente a
 * `ask_question`/`answerText` do Eve.
 *
 * Verificado no código-fonte instalado do Agno (não suposto):
 * `agno/os/interfaces/agui/stream.py` — uma tool com `requires_confirmation`
 * recebe TOOL_CALL_START/ARGS/END como qualquer outra, mas NUNCA um
 * TOOL_CALL_RESULT; é essa ausência, ao final do run, que sinaliza a pausa.
 * `agno/os/interfaces/agui/input.py` (`extract_tool_messages`) — a retomada é
 * a MESMA lista de mensagens com um `ToolMessage` (`role: "tool"`,
 * `toolCallId`, `content` = JSON) no final; o servidor só lê o que está à
 * direita da última mensagem que não é `role: "tool"`.
 */

export type ChatTurn =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string };

export type PendingApproval = {
  toolCallId: string;
  toolCallName: "commit_batch" | "reject_batch";
};

const GATED_TOOLS = new Set(["commit_batch", "reject_batch"]);

/**
 * FR-024: a tela nunca mostra o nome cru de uma tool. Isto é o único lugar
 * onde esses nomes aparecem — traduzidos para uma frase de progresso.
 */
const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  read_pdf_pages: "Lendo o documento…",
  save_extraction: "Organizando o que foi lido…",
  propose_batch: "Conferindo os lançamentos…",
  propose_batch_from_extraction: "Conferindo os lançamentos…",
  prepare_batch_registration: "Preparando o registro…",
  commit_batch: "Registrando no razão…",
  reject_batch: "Descartando a fatura…",
  read_batch: "Revendo a fatura…",
  list_invoices: "Consultando suas faturas…",
  list_documents: "Consultando seus documentos…",
};

function activityLabel(toolName: string): string {
  return TOOL_ACTIVITY_LABELS[toolName] ?? "Trabalhando…";
}

export function useAgUiChat({ agentHost }: { agentHost: string }) {
  const tokenRef = useRef<{ value: string; expiresAt: number } | null>(null);

  const bearer = useCallback(async () => {
    const cached = tokenRef.current;
    if (cached && cached.expiresAt - 30_000 > Date.now()) return cached.value;
    const response = await fetch("/api/token", { method: "POST" });
    if (!response.ok) throw new Error("Não foi possível autenticar com o agente.");
    const data = (await response.json()) as { token: string; expiresIn: number };
    tokenRef.current = { value: data.token, expiresAt: Date.now() + data.expiresIn * 1000 };
    return data.token;
  }, []);

  // Uma sessão AG-UI por montagem — trocar de conversa aqui é remontar (mesmo
  // mecanismo do hook anterior). O `threadId` é o que o servidor usa para
  // localizar um run pausado ao retomar; nasce novo a cada montagem porque a
  // retomada de conversa entre recarregamentos de página fica fora desta
  // etapa (ver nota no fim do arquivo).
  const agentRef = useRef<HttpAgent | null>(null);
  agentRef.current ??= new HttpAgent({
    url: `${agentHost}/agui`,
    threadId: crypto.randomUUID(),
    fetch: async (url, init) => {
      const token = await bearer();
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(url, { ...init, headers });
    },
  });
  const agent = agentRef.current;

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const isWelcome = turns.length === 0 && !busy && !uploading;

  /**
   * Roda um turno (novo ou retomada) e devolve só quando o stream fecha.
   * Os dois chamadores (`sendNow`/`answer`) já deixaram `agent.messages` no
   * estado certo antes de chamar isto — aqui só falta escutar o stream.
   */
  const runTurn = useCallback(async (params?: Parameters<HttpAgent["runAgent"]>[0]) => {
    setBusy(true);
    setError(null);
    setActivity(null);
    setPending(null);

    // Tool calls deste run que ainda não receberam resultado quando o run
    // termina — é essa ausência, e não uma flag do protocolo, que sinaliza
    // pausa (ver o comentário do topo do arquivo).
    const openToolCalls = new Map<string, string>();

    const subscriber: AgentSubscriber = {
      onTextMessageStartEvent: ({ event }) => {
        const id = event.messageId;
        setActivity(null);
        setTurns((prev) => [...prev, { kind: "assistant", id, text: "" }]);
      },
      onTextMessageContentEvent: ({ event }) => {
        setTurns((prev) =>
          prev.map((turn) =>
            turn.kind === "assistant" && turn.id === event.messageId
              ? { ...turn, text: turn.text + event.delta }
              : turn,
          ),
        );
      },
      onToolCallStartEvent: ({ event }) => {
        openToolCalls.set(event.toolCallId, event.toolCallName);
        setActivity(activityLabel(event.toolCallName));
      },
      onToolCallResultEvent: ({ event }) => {
        openToolCalls.delete(event.toolCallId);
      },
      onRunErrorEvent: ({ event }) => {
        setError(event.message);
      },
    };

    try {
      await agent.runAgent(params, subscriber);
      for (const [toolCallId, toolCallName] of openToolCalls) {
        if (GATED_TOOLS.has(toolCallName)) {
          setPending({ toolCallId, toolCallName: toolCallName as "commit_batch" | "reject_batch" });
          break;
        }
      }
    } catch (err) {
      setError(mensagemDeErro(err instanceof Error ? err.message : "Não consegui falar com a Clara."));
    } finally {
      setActivity(null);
      setBusy(false);
    }
  }, [agent]);

  const sendNow = useCallback(
    (text: string) => {
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text });
      setTurns((prev) => [...prev, { kind: "user", id: crypto.randomUUID(), text }]);
      void runTurn();
    },
    [agent, runTurn],
  );

  // A sessão não aceita dois runs concorrentes. Enfileirar mantém o
  // compositor conversável durante um turno longo — mesma decisão do hook
  // anterior, e pela mesma razão: silenciar o que a pessoa escreveu enquanto
  // a Clara trabalha é a pior coisa que uma caixa de texto pode fazer.
  const send = useCallback(
    (text: string) => {
      const normalized = text.trim();
      if (normalized === "") return;
      if (busy) {
        setQueuedMessages((prev) => [...prev, normalized]);
        return;
      }
      sendNow(normalized);
    },
    [busy, sendNow],
  );

  useEffect(() => {
    if (busy || queuedMessages.length === 0) return;
    const [next, ...rest] = queuedMessages;
    setQueuedMessages(rest);
    if (next !== undefined) sendNow(next);
  }, [busy, queuedMessages, sendNow]);

  const answer = useCallback(
    (accepted: boolean, note?: string) => {
      if (pending === null) return;
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "tool",
        toolCallId: pending.toolCallId,
        content: JSON.stringify(accepted ? { accepted: true } : { accepted: false, note }),
      });
      void runTurn();
    },
    [agent, pending, runTurn],
  );

  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      setUploadingName(file.name);
      setProgress(null);
      try {
        const result = await uploadDocument(file, (percentage) => setProgress(Math.round(percentage)));
        if (!result.ok) {
          toast.error(result.error, { action: { label: "Tentar de novo", onClick: () => void upload(file) } });
          return;
        }
        if (result.warning !== null) toast.warning(result.warning);

        // O nome do arquivo nunca aparece à pessoa (ver `coordinator.md`) —
        // só o rótulo que a extração devolve depois. Ele viaja só até o
        // modelo, como contexto de um turno só, via `context` do AG-UI.
        agent.addMessage({ id: crypto.randomUUID(), role: "user", content: "Enviei uma fatura." });
        setTurns((prev) => [...prev, { kind: "user", id: crypto.randomUUID(), text: "Enviei uma fatura." }]);
        await runTurn({
          context: [
            {
              description: "clientContext",
              value: JSON.stringify({
                event: "document_uploaded",
                documentId: result.documentId,
                filename: result.filename,
              }),
            },
          ],
        });
      } catch (err) {
        toast.error(mensagemDeErro(err instanceof Error ? err.message : "Não consegui enviar esse arquivo."), {
          action: { label: "Tentar de novo", onClick: () => void upload(file) },
        });
      } finally {
        setUploading(false);
        setUploadingName(null);
        setProgress(null);
      }
    },
    [agent, runTurn],
  );

  const cancel = useCallback(() => {
    // Best-effort e só do lado do cliente: `abortRun()` descola o stream,
    // mas nada aqui garante que o servidor pare de processar o turno — o
    // Agno não expõe uma rota de cancelamento equivalente a
    // `session.cancel` do Eve. Redução de escopo deliberada, não descuido.
    agent.abortRun();
    setBusy(false);
    setActivity(null);
  }, [agent]);

  return useMemo(
    () => ({
      turns,
      busy,
      activity,
      pending,
      error,
      isWelcome,
      queuedMessages,
      uploading,
      uploadingName,
      progress,
      send,
      answer,
      upload,
      cancel,
    }),
    [
      turns,
      busy,
      activity,
      pending,
      error,
      isWelcome,
      queuedMessages,
      uploading,
      uploadingName,
      progress,
      send,
      answer,
      upload,
      cancel,
    ],
  );
}
