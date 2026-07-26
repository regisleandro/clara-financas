"use client";

import { Client, type ClientSession } from "eve/client";
import { useEveAgent } from "eve/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { inflightTurnId } from "@/lib/activity";
import { resolveAnswered, type AnsweredRequest } from "@/lib/answered-state";
import { uploadDocument } from "@/lib/document-upload";
import { saveSession, type StoredSession } from "@/lib/session-store";
import { findPendingRequest, resolveApprovalOption } from "@clara-financas/views/hitl";

/**
 * A sessão da Clara, encapsulada: token, envio, upload, gate e persistência.
 *
 * Extraído do `chat.tsx`, que concentrava ~10 responsabilidades em 480 linhas.
 * O componente fica com layout e composição; o protocolo mora aqui.
 *
 * Persistência: o cursor (`SessionState`) e os eventos são gravados no
 * localStorage quando o turno termina — é o que permite recarregar a página e
 * retomar a conversa (`initialEvents` do eve + o cursor semeado na sessão).
 * Gravar por evento seria escrita demais durante o streaming; gravar no fim do
 * turno perde no pior caso o turno em voo.
 *
 * A `ClientSession` é NOSSA, não do store do eve: cancelar um turno é uma
 * operação de sessão (`session.cancel`), e o hook só tem o que oferecer ao
 * botão "Parar" se for ele quem segura o handle. Ver `cancel` abaixo.
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
  // Amarrado ao requestId respondido, não ao turno: gates encadeados no mesmo
  // turno têm ids diferentes, e o cartão do próximo precisa aparecer. Ver
  // `lib/answered-state.ts` para o bug que a forma global causava.
  const [answeredRequest, setAnsweredRequest] = useState<AnsweredRequest | null>(null);
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

  /**
   * A sessão desta conversa, criada UMA vez por montagem.
   *
   * `preserveCompletedSessions: true` porque a sessão é interativa, e a falta
   * disso quebrava DUAS coisas: o handle zera o cursor na fronteira
   * `session.completed` e leva embora o `sessionId` — que é o endereço da rota
   * de cancelamento, e é também o que `saveSession` exige para gravar. Sem ele
   * a conversa não entrava no registro local, e ao recarregar a página retomava
   * a última que por acaso ainda tinha cursor, não a última de verdade.
   *
   * Ref, não `useMemo`: memo é cache, não garantia, e um novo `Client` no meio
   * da conversa apontaria para uma sessão que não é a corrente.
   */
  const sessionRef = useRef<ClientSession | null>(null);
  sessionRef.current ??= new Client({
    host: agentHost,
    auth: { bearer },
    preserveCompletedSessions: true,
  }).session(initial?.cursor);
  const session = sessionRef.current;

  // O cursor vai na criação da sessão e `initialEvents` na do store; trocar de
  // conversa exige REMONTAR o componente que chama este hook (key= no pai) —
  // com sessão externa, `agent.reset()` reaproveita ESTE handle em vez de abrir
  // uma sessão nova, então o remonte não é conveniência, é o mecanismo.
  const agent = useEveAgent({
    session,
    ...(initial !== null ? { initialEvents: initial.events as never[] } : {}),
  });

  const busy = agent.status === "submitted" || agent.status === "streaming";
  const pending = findPendingRequest(agent.data.messages);
  const answered = resolveAnswered(pending, answeredRequest);
  const isWelcome = agent.data.messages.length === 0;

  // Reatribuídos a cada render: um `useMemo` no chamador guardaria a versão
  // antiga de `agent` se chamasse as funções direto, e o clique dispararia
  // contra uma sessão que já não é a corrente.
  const sendRef = useRef<(message: string) => void>(() => {});
  const answerRef = useRef<(optionId: string) => void>(() => {});
  answerRef.current = (optionId: string) => {
    if (!pending) return;
    // "approve" e "deny" são INTENÇÕES vindas dos cartões, não ids: quem sabe
    // o id de verdade é o pedido. As respostas de `ask_question` já chegam com
    // o id da opção e passam direto.
    const intent = optionId === "approve" || optionId === "deny" ? optionId : null;
    const resolved = intent === null ? optionId : resolveApprovalOption(pending, intent);
    const { requestId } = pending;
    setAnsweredRequest({ requestId, approved: intent === null ? true : intent === "approve" });
    // Se o envio falhar (token vencido, ACL da sessão), o cartão precisa
    // VOLTAR: antes o estado ficava marcado como respondido e a única pista
    // era o bloco de erro genérico — sem nada clicável para tentar de novo.
    void Promise.resolve(
      agent.send({
        inputResponses: [{ requestId, optionId: resolved }],
      }),
    ).catch((error: unknown) => {
      setAnsweredRequest((current) => (current?.requestId === requestId ? null : current));
      toast.error(
        error instanceof Error && error.message !== ""
          ? error.message
          : "Não consegui enviar a resposta. Tente de novo.",
      );
    });
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

      const { requestId } = pending;
      setAnsweredRequest({ requestId, approved: true });
      // Mesmo cuidado do `answer`: o `try` de fora só cobre o selamento da
      // senha; o envio em si falhando precisa devolver o campo de resposta.
      void Promise.resolve(
        agent.send({
          inputResponses: [
            {
              requestId,
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
        }),
      ).catch((error: unknown) => {
        setAnsweredRequest((current) => (current?.requestId === requestId ? null : current));
        toast.error(
          error instanceof Error && error.message !== ""
            ? error.message
            : "Não foi possível enviar a resposta.",
        );
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar a resposta.");
    }
  };

  /**
   * Cancela o turno em voo — de verdade, no servidor.
   *
   * `agent.stop()` é LOCAL: descola o stream do cliente e nada mais. O turno
   * continua rodando (e cobrando) do outro lado, e o botão "Parar" que chamava
   * aquilo mentia. Cancelar é `session.cancel({ turnId })`, com três cuidados
   * que a doc do eve trata como parte do contrato:
   *
   * 1. O `turnId` é o do turno OBSERVADO no stream. Sem ele, um clique que
   *    chega tarde cancelaria o turno seguinte; com ele, o servidor consome o
   *    pedido como no-op. Enquanto nenhum `turn.started` chegou não há o que
   *    cancelar, e `canCancel` fica falso em vez de a UI fingir que dá.
   * 2. O stream fica ABERTO. O cancelamento é assíncrono e assenta na
   *    fronteira (`turn.cancelled` → `session.waiting`); é ela que devolve o
   *    status para `ready`. Abortar aqui trocaria um botão morto por um
   *    cancelamento cego.
   * 3. `no_active_turn` é sucesso, não erro — o turno assentou antes do pedido
   *    chegar. Só falha de transporte ou recusa da rota viram recado na tela.
   */
  const [cancellingTurn, setCancellingTurn] = useState<string | null>(null);
  const turnId = inflightTurnId(agent.events);
  const cancelling = turnId !== null && cancellingTurn === turnId;
  const canCancel = turnId !== null && !cancelling;

  const cancelRef = useRef<() => void>(() => {});
  cancelRef.current = () => {
    if (turnId === null || cancelling) return;
    setCancellingTurn(turnId);
    void session.cancel({ turnId }).catch((error: unknown) => {
      // Pedido recusado: o turno SEGUE rodando. Devolver o botão ao estado
      // clicável é o que permite tentar de novo — e o recado é o que evita a
      // pessoa achar que parou.
      setCancellingTurn((current) => (current === turnId ? null : current));
      // A mensagem da rota é do eve, em inglês ("Session does not belong to
      // this user."): serve para depurar, não para a tela.
      console.warn("[clara] cancelamento recusado", { turnId, error });
      toast.error("Não consegui interromper agora — a Clara ainda está trabalhando.");
    });
  };

  const onTurnStartRef = useRef<() => void>(() => {});
  sendRef.current = (message: string) => {
    setAnsweredRequest(null);
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
      // O `catch` faltava, e o buraco era exatamente o caminho não previsto:
      // `uploadDocument` devolve `{ ok: false }` para o que ele antecipa, mas
      // um `fetch` que rejeita ou o parser estourando dentro do PDF viram
      // exceção. Sem isto a promessa rejeitava sem dono, o spinner do "+"
      // parava e a conversa não dizia nada — a pessoa ficava esperando uma
      // fatura que nunca chegou.
      const result = await uploadDocument(file, (percentage) =>
        setProgress(Math.round(percentage)),
      );

      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.warning !== null) toast.warning(result.warning);

      setAnsweredRequest(null);
      onTurnStartRef.current();
      void agent.send({
        message: `Enviei ${result.filename}.`,
        clientContext: {
          event: "document_uploaded",
          documentId: result.documentId,
          filename: result.filename,
        },
      });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message !== ""
          ? error.message
          : "Não consegui enviar esse arquivo. Tente de novo.",
      );
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

  // Só grava depois de um turno REAL desta montagem. Antes, montar já bastava
  // para regravar a conversa retomada — e como o registro era ordenado por
  // data, abrir uma conversa antiga a promovia a "a última", embaralhando qual
  // conversa a próxima visita retomaria. Agora quem responde por isso é o
  // ponteiro de conversa aberta (`setActiveConversation`), e `updatedAt` volta
  // a significar atividade de verdade — que é o que o menu mostra.
  const turnRan = useRef(false);

  useEffect(() => {
    if (agent.status === "submitted" || agent.status === "streaming") {
      turnRan.current = true;
      return;
    }
    if (!turnRan.current) return;
    const { session: cursor, events, firstUserText: title } = snapshotRef.current;
    if (events.length === 0) return;
    saveSession(tenantKey, cursor, events, title);
  }, [agent.status, tenantKey]);

  return {
    agent,
    busy,
    uploading,
    progress,
    pending,
    answered,
    isWelcome,
    /** Há um turno observado para cancelar, e nenhum pedido em voo. */
    canCancel,
    /** O cancelamento foi pedido e a fronteira ainda não chegou. */
    cancelling,
    upload,
    /** Envia uma mensagem de texto (turno novo). */
    send: (message: string) => sendRef.current(message),
    /** Interrompe o turno em voo no servidor (não é `stop()`). */
    cancel: () => cancelRef.current(),
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
