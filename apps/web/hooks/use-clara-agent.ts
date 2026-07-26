"use client";

import { useEveAgent } from "eve/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { uploadDocument } from "@/lib/document-upload";
import { saveSession, type StoredSession } from "@/lib/session-store";
import { findPendingRequest } from "@clara-financas/views/hitl";

/**
 * A sessão da Clara, encapsulada: token, envio, upload, gate e persistência.
 *
 * Extraído do `chat.tsx`, que concentrava ~10 responsabilidades em 480 linhas.
 * O componente fica com layout e composição; o protocolo mora aqui.
 *
 * Persistência: o cursor (`SessionState`) e os eventos são gravados no
 * localStorage quando o turno termina — é o que permite recarregar a página e
 * retomar a conversa (`initialSession`/`initialEvents` do eve). Gravar por
 * evento seria escrita demais durante o streaming; gravar no fim do turno
 * perde no pior caso o turno em voo.
 */
export function useClaraAgent({
  agentHost,
  tenantKey,
  initial,
}: {
  agentHost: string;
  tenantKey: string;
  /** Sessão retomada do storage, ou null para conversa nova. */
  initial: StoredSession | null;
}) {
  const tokenRef = useRef<{ value: string; expiresAt: number } | null>(null);
  const [answered, setAnswered] = useState<boolean | null>(null);
  const [uploading, setUploading] = useState(false);
  /** Porcentagem do upload direto, ou `null` fora dele (hash, parser, registro). */
  const [progress, setProgress] = useState<number | null>(null);

  const bearer = useCallback(async () => {
    const cached = tokenRef.current;
    // 30s de folga para não usar um token que expira no meio do voo.
    if (cached && cached.expiresAt - 30_000 > Date.now()) return cached.value;

    const response = await fetch("/api/token", { method: "POST" });
    if (!response.ok) throw new Error("Não foi possível autenticar com o agente.");

    const data = (await response.json()) as { token: string; expiresIn: number };
    tokenRef.current = { value: data.token, expiresAt: Date.now() + data.expiresIn * 1000 };
    return data.token;
  }, []);

  // `initialSession`/`initialEvents` são lidos na criação do store; trocar de
  // conversa exige REMONTAR o componente que chama este hook (key= no pai).
  const agent = useEveAgent({
    host: agentHost,
    auth: { bearer },
    ...(initial !== null
      ? {
          initialSession: initial.cursor,
          initialEvents: initial.events as never[],
        }
      : {}),
  });

  const busy = agent.status === "submitted" || agent.status === "streaming";
  const pending = findPendingRequest(agent.data.messages);
  const isWelcome = agent.data.messages.length === 0;

  // Reatribuídos a cada render: um `useMemo` no chamador guardaria a versão
  // antiga de `agent` se chamasse as funções direto, e o clique dispararia
  // contra uma sessão que já não é a corrente.
  const sendRef = useRef<(message: string) => void>(() => {});
  const answerRef = useRef<(optionId: string) => void>(() => {});
  answerRef.current = (optionId: string) => {
    if (!pending) return;
    setAnswered(optionId === "approve");
    void agent.send({ inputResponses: [{ requestId: pending.requestId, optionId }] });
  };

  const answerTextRef = useRef<(text: string, sensitive?: boolean) => Promise<void>>(
    async () => {},
  );
  answerTextRef.current = async (text: string, sensitive = false) => {
    if (!pending) return;
    try {
      let protectedInput: { requestId: string; token: string } | undefined;
      if (sensitive) {
        const response = await fetch("/api/documents/password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestId: pending.requestId, password: text }),
        });
        if (!response.ok) throw new Error("Não foi possível proteger a senha.");
        const data = (await response.json()) as { token: string };
        protectedInput = { requestId: pending.requestId, token: data.token };
      }

      setAnswered(true);
      void agent.send({
        inputResponses: [
          {
            requestId: pending.requestId,
            text: sensitive ? "Resposta protegida fornecida." : text,
          },
        ],
        ...(protectedInput
          ? {
              clientContext: {
                protectedInput: {
                  ...protectedInput,
                  instruction:
                    "Encaminhe este token somente à tool de leitura do documento. Não o repita.",
                },
              },
            }
          : {}),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar a resposta.");
    }
  };

  const onTurnStartRef = useRef<() => void>(() => {});
  sendRef.current = (message: string) => {
    setAnswered(null);
    onTurnStartRef.current();
    void agent.send({ message });
  };

  /**
   * O PDF não passa pela nossa API: o parser roda aqui, o arquivo vai direto
   * para o armazenamento e a função recebe apenas o registro. `uploadDocument`
   * guarda essa coreografia; o que interessa nesta camada é o progresso e o
   * recado quando algo sai do trilho.
   */
  async function upload(file: File) {
    setUploading(true);
    setProgress(null);
    try {
      const result = await uploadDocument(file, (percentage) =>
        setProgress(Math.round(percentage)),
      );

      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.warning !== null) toast.warning(result.warning);

      setAnswered(null);
      onTurnStartRef.current();
      void agent.send({
        message: `Enviei ${result.filename}.`,
        clientContext: {
          event: "document_uploaded",
          documentId: result.documentId,
          filename: result.filename,
        },
      });
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  // Título da conversa no registro: a primeira mensagem da pessoa.
  const firstUserText = useMemo(() => {
    for (const message of agent.data.messages) {
      if (message.role !== "user") continue;
      const text = message.parts
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
        .trim();
      if (text !== "") return text;
    }
    return null;
  }, [agent.data.messages]);

  // Persiste quando o turno assenta. Refs para ler o snapshot corrente sem
  // recriar o efeito a cada evento do stream.
  const snapshotRef = useRef({ session: agent.session, events: agent.events, firstUserText });
  snapshotRef.current = { session: agent.session, events: agent.events, firstUserText };

  useEffect(() => {
    if (agent.status !== "ready" && agent.status !== "error") return;
    const { session, events, firstUserText: title } = snapshotRef.current;
    if (events.length === 0) return;
    saveSession(tenantKey, session, events, title);
  }, [agent.status, tenantKey]);

  return {
    agent,
    busy,
    uploading,
    progress,
    pending,
    answered,
    isWelcome,
    upload,
    /** Envia uma mensagem de texto (turno novo). */
    send: (message: string) => sendRef.current(message),
    /** Responde o gate pendente (aprovar/negar/opção). */
    answer: (optionId: string) => answerRef.current(optionId),
    /** Responde uma pergunta livre; valores sensíveis viajam em contexto efêmero. */
    answerText: (text: string, sensitive = false) =>
      answerTextRef.current(text, sensitive),
    /** Registra o que fazer quando um turno novo começa (ex.: reabrir painel). */
    onTurnStart: (fn: () => void) => {
      onTurnStartRef.current = fn;
    },
    sendRef,
    answerRef,
  };
}
