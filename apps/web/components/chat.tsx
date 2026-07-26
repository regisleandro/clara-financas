"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputBody,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { InputGroupAddon } from "@/components/ui/input-group";
import { ArtifactAside, ArtifactModal } from "@/components/artifact-surface";
import { ChatHeader, ChatWelcome, type Starter } from "@/components/chat-welcome";
import { ChatMessage } from "@/components/chat-message";
import { DecisionCard } from "@/components/decision-card";
import { ExecutionTrace } from "@/components/execution-trace";
import { useArtifactSelection } from "@/hooks/use-artifact-selection";
import { useClaraAgent } from "@/hooks/use-clara-agent";
import { deriveActivity } from "@/lib/activity";
import { batchArtifact, type BatchProposal } from "@/lib/artifact";
import { deriveFollowups } from "@/lib/followups";
import {
  latestConversation,
  listConversations,
  loadSession,
  removeConversation,
  type StoredSession,
} from "@/lib/session-store";
import { useMediaQuery } from "@/lib/use-media-query";
import { findOpenBatchProposalLocation, findPendingRequest } from "@clara-financas/views/hitl";

/**
 * A conversa, em duas colunas.
 *
 * O artefato abre à DIREITA, fixo, e a conversa segue ao lado — é assim no
 * protótipo, e a razão é de uso: o artefato é consultado enquanto se decide.
 *
 * Este componente é o ORQUESTRADOR: protocolo do agente em `useClaraAgent`,
 * seleção de artefato em `useArtifactSelection`, renderização por parte em
 * `ChatMessage`, persistência em `lib/session-store`. O que fica aqui é
 * composição e layout.
 *
 * A retomada de conversa exige remontar (`key={conversationKey}`): o eve lê
 * `initialSession`/`initialEvents` na criação do store. O invólucro `Chat`
 * resolve o estado inicial do localStorage DEPOIS de montar — client
 * component ainda renderiza no servidor, onde localStorage não existe.
 */

const FALLBACK_STARTERS: readonly Starter[] = [
  { title: "Enviar um documento", note: "Fatura, extrato ou nota fiscal em PDF", prompt: null },
];

const FALLBACK_FOLLOWUPS = ["Detalhar por categoria"];

type ChatProps = {
  agentHost: string;
  name: string | null;
  starters: readonly Starter[];
  followups: readonly string[];
  /** Identificador opaco do tenant, chave do armazenamento local. */
  tenantKey: string;
};

export function Chat(props: ChatProps) {
  const [boot, setBoot] = useState<
    { key: string; initial: StoredSession | null } | null
  >(null);

  useEffect(() => {
    const latest = latestConversation(props.tenantKey);
    const stored = latest === null ? null : loadSession(props.tenantKey, latest.sessionId);
    setBoot({ key: latest?.sessionId ?? "new", initial: stored });
  }, [props.tenantKey]);

  // Antes de ler o storage não há o que desenhar além do esqueleto do layout;
  // um frame em branco evita hidratar com estado errado e piscar a boas-vindas
  // de quem tem conversa a retomar.
  if (boot === null) return <div className="h-[calc(100svh-3rem)]" />;

  return (
    <ChatSession
      key={boot.key}
      {...props}
      initial={boot.initial}
      onSwitchConversation={(sessionId) => {
        const stored = sessionId === null ? null : loadSession(props.tenantKey, sessionId);
        setBoot({ key: sessionId ?? `new-${Date.now()}`, initial: stored });
      }}
    />
  );
}

function ChatSession({
  agentHost,
  name,
  starters,
  followups,
  tenantKey,
  initial,
  onSwitchConversation,
}: ChatProps & {
  initial: StoredSession | null;
  onSwitchConversation: (sessionId: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  // No celular o artefato é uma modal; no desktop, a coluna fixa à direita. O
  // Radix trava a rolagem de fundo mesmo com o conteúdo escondido por CSS,
  // então a modal só pode MONTAR aberta abaixo de `lg`.
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const clara = useClaraAgent({ agentHost, tenantKey, initial });
  const { agent, busy, uploading, pending, answered, isWelcome } = clara;

  const activity = useMemo(() => deriveActivity(agent.events), [agent.events]);

  // `findOpenBatchProposalLocation` some assim que o lote é registrado — o
  // cartão não pode sobreviver ao commit oferecendo "Registrar fatura" sobre
  // algo que já entrou no razão.
  const proposalLocation = useMemo(
    () => findOpenBatchProposalLocation(agent.data.messages),
    [agent.data.messages],
  );
  const proposal = (proposalLocation?.output ?? null) as BatchProposal | null;
  const canApprove = pending?.toolName === "commit_batch" && answered === null;

  /**
   * A conferência de um lote é a exceção que continua sendo derivada no
   * cliente: ela precisa carregar os botões do gate, e botões são estado do
   * cliente, não payload do modelo. O botão NUNCA fica morto: quando a Clara
   * termina a conferência sem chamar `commit_batch`, o clique envia uma
   * mensagem pedindo que ela abra o gate — instrução não é garantia.
   */
  const artifact = useMemo(() => {
    if (proposal === null) return null;
    return batchArtifact(proposal, {
      onApprove: () =>
        canApprove
          ? clara.answerRef.current("approve")
          : clara.sendRef.current(`Registre o lote ${proposal.batchId} no razão.`),
      onReject: () =>
        canApprove
          ? clara.answerRef.current("deny")
          : clara.sendRef.current(
              `Descarte o lote ${proposal.batchId}. Não quero registrar essa fatura.`,
            ),
      // `answered !== null` cobre a janela entre o clique e o resultado.
      disabled: busy || answered !== null,
      pendingGate: canApprove,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal, busy, canApprove, answered]);

  const {
    setSelection,
    presented,
    messageArtifacts,
    active,
    panelOpen,
    openArtifact,
  } = useArtifactSelection({
    messages: agent.data.messages,
    events: agent.events,
    artifact,
    proposalMessageId: proposalLocation?.messageId ?? null,
    // Painel inválido não pode mais sumir em silêncio: este é o ponto único
    // de telemetria — o sintoma "o artefato às vezes não abre" era
    // indepurável sem ele.
    onInvalidView: (issues, callId) =>
      console.warn("[clara] present_view inválido", { issues, callId }),
  });

  // Turno novo: a coluna volta a seguir o artefato mais recente.
  clara.onTurnStart(() => setSelection({ type: "latest" }));

  // Follow-ups do turno (derivados do painel) na frente dos do servidor
  // (derivados do razão).
  const turnFollowups = useMemo(
    () => deriveFollowups(presented, followups.length > 0 ? followups : FALLBACK_FOLLOWUPS),
    [presented, followups],
  );

  const startNewConversation = () => {
    const sessionId = agent.session.sessionId;
    if (sessionId !== undefined) removeConversation(tenantKey, sessionId);
    agent.reset();
    onSwitchConversation(null);
  };

  // O registro local de conversas, para o menu do cabeçalho. Recalculado por
  // status: quando um turno termina, a persistência acabou de rodar.
  const conversations = useMemo(
    () => listConversations(tenantKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenantKey, agent.status],
  );

  return (
    <div className="flex">
      {/* Altura FIXA, não mínima: a conversa rola por dentro em vez de
          empurrar a página; a largura de leitura é imposta em cada faixa. */}
      <div className="flex h-[calc(100svh-3rem)] min-w-0 flex-1 flex-col">
        <div className="shrink-0 bg-background">
          <div className="mx-auto w-full max-w-[720px] px-6 pb-4 pt-8">
            <ChatHeader
              onReset={isWelcome ? null : startNewConversation}
              onToggleArtifact={
                !panelOpen && artifact === null && presented === null
                  ? null
                  : () => setSelection(panelOpen ? null : { type: "latest" })
              }
              artifactOpen={panelOpen}
              conversations={conversations}
              activeSessionId={agent.session.sessionId}
              onSelectConversation={(sessionId) => onSwitchConversation(sessionId)}
            />
          </div>
        </div>

        {/* `min-h-0` permite encolher abaixo do conteúdo; sem ele a rolagem
            interna nunca acontece. */}
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-[720px] space-y-8 px-6 pb-8 pt-4">
            {isWelcome ? (
              <ChatWelcome
                name={name}
                starters={starters.length > 0 ? starters : FALLBACK_STARTERS}
                disabled={busy || uploading}
                onPick={(starter) => {
                  if (starter.prompt === null) fileRef.current?.click();
                  else clara.send(starter.prompt);
                }}
              />
            ) : null}

            {initial?.eventsDropped === true && isWelcome ? (
              <p className="clara-card p-5 text-sm text-[var(--clara-graphite)]">
                A conversa anterior era longa demais para guardar o histórico
                visual — a sessão continua de onde parou, mas as mensagens
                antigas não aparecem aqui.
              </p>
            ) : null}

            {agent.data.messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                hasArtifact={message.role !== "user" && messageArtifacts.has(message.id)}
                onOpenArtifact={() => openArtifact(message.id)}
              />
            ))}

            {!isWelcome ? <ExecutionTrace activity={activity} busy={busy} /> : null}

            {/* A decisão sobre o lote vem PRIMEIRO e dentro da conversa: é o
                momento em que a pessoa decide. */}
            {pending?.toolName === "commit_batch" && answered === null ? (
              <DecisionCard
                pending={pending}
                proposal={proposal}
                disabled={busy}
                onAnswer={clara.answer}
              />
            ) : pending && pending.toolName !== "commit_batch" ? (
              <GenericPrompt pending={pending} disabled={busy} onAnswer={clara.answer} />
            ) : null}

            {!isWelcome && !busy && pending === null ? (
              <div>
                <p className="clara-eyebrow mb-3">Continuar</p>
                <Suggestions>
                  {turnFollowups.map((followup) => (
                    <Suggestion key={followup} suggestion={followup} onClick={clara.send} />
                  ))}
                </Suggestions>
              </div>
            ) : null}

            {agent.error ? (
              <div className="clara-card space-y-4 p-5">
                <p className="text-[var(--clara-amber)]">{agent.error.message}</p>
                {/* Retomada pode falhar de forma terminal (sessão expirada no
                    servidor, token de continuação consumido). O caminho
                    honesto é recomeçar — o razão está no banco; o que se
                    perde é só o fio da conversa. */}
                {initial !== null ? (
                  <button
                    type="button"
                    onClick={startNewConversation}
                    className="clara-pill clara-pill-outline h-8 px-4 text-xs"
                  >
                    Começar nova conversa
                  </button>
                ) : null}
              </div>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="shrink-0 bg-background">
          <div className="mx-auto w-full max-w-[720px] px-6 pb-8 pt-2">
            <PromptInput
              className="items-center rounded-[var(--clara-radius-card)] py-1.5 pl-2 pr-1.5"
              onSubmit={(message, event) => {
                event.preventDefault();
                const text = message.text?.trim();
                if (text === undefined || text === "" || busy) return;
                clara.send(text);
              }}
            >
              <InputGroupAddon align="inline-start">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || busy}
                  aria-label="Anexar fatura em PDF"
                  className="grid size-8 place-items-center rounded-full bg-[var(--clara-fog)] text-base leading-none transition-colors hover:bg-[var(--clara-ash)] disabled:opacity-50"
                >
                  {uploading ? "…" : "+"}
                </button>
              </InputGroupAddon>
              <PromptInputBody>
                <PromptInputTextarea
                  placeholder="Pergunte sobre seu dinheiro…"
                  disabled={busy}
                  rows={1}
                  className="min-h-11 py-2.5"
                />
              </PromptInputBody>
              <InputGroupAddon align="inline-end">
                {/* Durante o streaming o botão vira "Parar" DE VERDADE: antes
                    ele só trocava o ícone, sem função — um botão de stop morto
                    é pior que nenhum. */}
                <PromptInputSubmit
                  status={agent.status === "error" ? "ready" : agent.status}
                  onStop={() => agent.stop()}
                  size="sm"
                  className="clara-pill clara-pill-primary h-10 w-auto px-5 text-sm"
                >
                  {busy ? "Parar" : "Enviar"}
                </PromptInputSubmit>
              </InputGroupAddon>
            </PromptInput>
          </div>
        </div>
      </div>

      {/* Mesmo artefato, duas molduras: coluna fixa no desktop e modal em
          tela cheia no celular. */}
      {active !== null ? (
        <ArtifactAside active={active} onClose={() => setSelection(null)} />
      ) : null}
      <ArtifactModal
        active={active}
        open={panelOpen && !isDesktop}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
      />

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void clara.upload(file);
        }}
      />
    </div>
  );
}

/** Aprovação genérica e `ask_question` — inclusive o pedido de senha do PDF. */
function GenericPrompt({
  pending,
  disabled,
  onAnswer,
}: {
  pending: NonNullable<ReturnType<typeof findPendingRequest>>;
  disabled: boolean;
  onAnswer: (optionId: string) => void;
}) {
  const options = pending.options?.length
    ? pending.options
    : [
        { optionId: "approve", label: "Aprovar" },
        { optionId: "deny", label: "Não" },
      ];

  return (
    <section className="clara-card p-7">
      <p className="clara-display-xs">
        {pending.prompt ?? "A Clara precisa da sua confirmação."}
      </p>
      <Suggestions className="mt-5">
        {options.map((option, index) => {
          const id = option.optionId ?? option.id ?? String(index);
          return (
            <Suggestion
              key={id}
              suggestion={option.label ?? id}
              disabled={disabled}
              onClick={() => onAnswer(id)}
            />
          );
        })}
      </Suggestions>
    </section>
  );
}
