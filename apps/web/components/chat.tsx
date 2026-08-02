"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, Send } from "lucide-react";

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
import { ChatWelcome, type Starter } from "@/components/chat-welcome";
import { ChatMessage } from "@/components/chat-message";
import { DecisionCard } from "@/components/decision-card";
import { ExecutionTrace } from "@/components/execution-trace";
import { useArtifactSelection } from "@/hooks/use-artifact-selection";
import { useClaraAgent } from "@/hooks/use-clara-agent";
import { deriveActivity } from "@/lib/activity";
import { mensagemDeErro } from "@/lib/agent-error";
import { batchArtifact, type BatchProposal } from "@/lib/artifact";
import { deriveFollowups } from "@/lib/followups";
import {
  clearResume,
  listConversations,
  loadSession,
  resumeTarget,
  type StoredSession,
} from "@/lib/session-store";
import { useMediaQuery } from "@/lib/use-media-query";
import {
  findActionProposalForPending,
  findBatchProposalForPending,
  findBatchProposals,
  findOpenBatchProposalLocation,
  findPendingRequest,
} from "@clara-financas/views/hitl";

/**
 * A conversa, em duas colunas.
 *
 * Detalhes abre à DIREITA, fixo, e a conversa segue ao lado — é assim no
 * protótipo, e a razão é de uso: Detalhes é consultado enquanto se decide.
 *
 * Este componente é o ORQUESTRADOR: protocolo do agente em `useClaraAgent`,
 * seleção de Detalhes em `useArtifactSelection`, renderização por parte em
 * `ChatMessage`, persistência em `lib/session-store`. O que fica aqui é
 * composição e layout.
 *
 * A retomada de conversa exige remontar (`key={conversationKey}`): o cursor
 * semeia a `ClientSession` e os eventos são lidos na criação do store, ambos
 * uma vez só. O invólucro `Chat` resolve o estado inicial do localStorage
 * DEPOIS de montar — client component ainda renderiza no servidor, onde
 * localStorage não existe.
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
    // Chegar à tela abre LIMPO. A única exceção é o bilhete de retomada, que
    // só existe quando a pessoa saiu daqui com um turno no ar — ver
    // `resumeTarget`. Ele mora no `sessionStorage`, então navegador reaberto e
    // aba nova nunca o têm.
    const sessionId = resumeTarget(props.tenantKey);
    if (sessionId === null) {
      setBoot({ key: "new", initial: null });
      return;
    }
    // Registro aponta para uma conversa sem payload (quota, limpeza parcial):
    // abrir em branco é honesto — retomar com o histórico de outra não seria.
    const stored = loadSession(props.tenantKey, sessionId);
    setBoot({ key: stored === null ? "new" : sessionId, initial: stored });
  }, [props.tenantKey]);

  useEffect(() => {
    const onOpenConversation = (event: Event) => {
      const sessionId = (event as ConversationEvent).detail?.sessionId ?? null;
      // Mesma razão de `onSwitchConversation`: abrir uma conversa pelo menu é
      // uma escolha desta visita, não um destino guardado para a próxima.
      clearResume(props.tenantKey);
      const stored = sessionId === null ? null : loadSession(props.tenantKey, sessionId);
      setBoot({ key: sessionId ?? `new-${Date.now()}`, initial: stored });
    };

    window.addEventListener("clara:open-conversation", onOpenConversation);
    return () => window.removeEventListener("clara:open-conversation", onOpenConversation);
  }, [props.tenantKey]);

  // Antes de ler o storage não há o que desenhar além do esqueleto do layout;
  // um frame em branco evita hidratar com estado errado e piscar a boas-vindas
  // de quem tem conversa a retomar.
  if (boot === null) return <ChatBootSkeleton />;

  return (
    <ChatSession
      key={boot.key}
      {...props}
      initial={boot.initial}
      onSwitchConversation={(sessionId) => {
        // Trocar de conversa é uma escolha desta visita, não um destino
        // guardado: o bilhete morre aqui e só volta a existir se um turno
        // desta conversa ficar no ar quando a pessoa sair da tela.
        clearResume(props.tenantKey);
        const stored = sessionId === null ? null : loadSession(props.tenantKey, sessionId);
        setBoot({ key: sessionId ?? `new-${Date.now()}`, initial: stored });
      }}
    />
  );
}

type ConversationEvent = CustomEvent<{ sessionId: string | null }>;

/**
 * A moldura da conversa enquanto o storage não respondeu.
 *
 * Antes era um `<div>` vazio com altura de tela. Na hidratação rápida isso não
 * custa nada, mas este é também o HTML que o servidor manda: em conexão ou
 * aparelho lento a pessoa olha para uma tela branca sem saber se abriu.
 *
 * O que aparece aqui é só o que é VERDADE nos dois desfechos possíveis — o
 * cabeçalho e o campo de escrita existem tanto na conversa retomada quanto na
 * nova. Não há bolha de mensagem falsa: metade das vezes não haveria mensagem
 * nenhuma, e prometer conteúdo que não vem é pior que não prometer nada.
 *
 * A entrada tem atraso (`.clara-boot`, em `globals.css`): quando o storage
 * responde no primeiro frame — o caso comum — o esqueleto nunca chega a ser
 * pintado, em vez de piscar.
 */
function ChatBootSkeleton() {
  return (
    <div className="clara-chat-layout clara-boot" aria-hidden="true">
      <div className="clara-chat-column">
        <div className="clara-chat-heading">
          <div>
            <div className="clara-boot-bar" style={{ width: 132, height: 9 }} />
            <div className="clara-boot-bar" style={{ width: 232, height: 30, marginTop: 14 }} />
          </div>
        </div>
        <div className="clara-boot-spacer" />
        <div className="clara-composer-wrap">
          <div className="clara-boot-composer" />
        </div>
      </div>
    </div>
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

  // No celular Detalhes é uma modal; no desktop, a coluna fixa à direita. O
  // Radix trava a rolagem de fundo mesmo com o conteúdo escondido por CSS,
  // então a modal só pode MONTAR aberta abaixo de `lg`.
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const clara = useClaraAgent({ agentHost, tenantKey, initial });
  const {
    agent,
    busy,
    uploading,
    uploadingName,
    progress,
    pending,
    answered,
    isWelcome,
    queuedMessages,
    lastUserText,
    retry,
  } = clara;
  const { canCancel, cancelling } = clara;

  const activity = useMemo(() => deriveActivity(agent.events), [agent.events]);

  // `findOpenBatchProposalLocation` some assim que o lote é registrado — o
  // cartão não pode sobreviver ao commit oferecendo "Registrar fatura" sobre
  // algo que já entrou no razão.
  const proposalLocation = useMemo(
    () => findOpenBatchProposalLocation(agent.data.messages),
    [agent.data.messages],
  );

  // Todas as conferências da conversa, para que as já decididas continuem
  // alcançáveis pelo link da resposta que as trouxe.
  const proposals = useMemo(
    () => findBatchProposals(agent.data.messages),
    [agent.data.messages],
  );
  const proposal = (proposalLocation?.output ?? null) as BatchProposal | null;
  const pendingProposalLocation = useMemo(
    () => findBatchProposalForPending(agent.data.messages, pending),
    [agent.data.messages, pending],
  );
  const pendingProposal = (pendingProposalLocation?.output ?? null) as BatchProposal | null;
  const pendingActionProposal = useMemo(
    () => findActionProposalForPending(agent.data.messages, pending),
    [agent.data.messages, pending],
  );
  const canApprove =
    pending?.toolName === "commit_batch" &&
    answered === null &&
    pendingProposal?.batchId === proposal?.batchId;
  /*
   * Escrever nunca é bloqueado; ENVIAR é que espera.
   *
   * O compositor inteiro ficava indisponível durante o upload — um PDF de 20MB
   * deixa a caixa de texto morta por dezenas de segundos, justamente quando a
   * pessoa quer dizer o que enviou. Digitar e enfileirar não dependem de nada
   * do servidor; só o envio depende, e a fila já cuida disso.
   *
   * A janela em que uma decisão foi clicada e ainda não chegou continua
   * travando, porque ali a próxima mensagem mudaria o significado do clique.
   */
  const sendLocked = answered !== null;

  /**
   * Sair da conversa é outra coisa que digitar nela.
   *
   * "Nova conversa" e o menu de conversas seguiam o `interactionLocked`, que
   * inclui um cartão de decisão em aberto. O resultado era a armadilha: uma
   * conversa retomada com um gate pendente — de um turno que já morreu, sem
   * nada a decidir — trancava as duas saídas, e não havia como começar de novo
   * a não ser limpando o storage. Um pedido em aberto é motivo para bloquear a
   * caixa de texto, nunca para prender a pessoa na conversa.
   *
   * Turno NO AR ainda tranca: trocar de conversa é remontar, e o turno
   * continuaria rodando no servidor sem ninguém escutando. Para isso existe o
   * botão "Parar", que cancela de verdade.
   */
  const navigationLocked = busy || uploading;

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
    panelFailed,
    invalidIssues,
    messageArtifacts,
    active,
    panelOpen,
    openArtifact,
  } = useArtifactSelection({
    messages: agent.data.messages,
    events: agent.events,
    artifact,
    proposalMessageId: proposalLocation?.messageId ?? null,
    proposalBatchId: typeof proposal?.batchId === "string" ? proposal.batchId : null,
    proposals,
    // O turno é o que faz a coluna reabrir a cada pergunta — inclusive quando
    // a pergunta se repete e o painel sai idêntico.
    turnId: activity.turnId,
    // No celular a modal cobre a conversa; lá Detalhes abre pelo link.
    autoOpen: isDesktop,
  });

  // Painel inválido não pode sumir em silêncio. A tela diz que não deu (ver
  // abaixo, na conversa); aqui fica o rastro para quem for depurar.
  useEffect(() => {
    if (invalidIssues.length > 0) {
      console.warn("[clara] present_view inválido", { issues: invalidIssues });
    }
  }, [invalidIssues]);

  // Turno novo: a coluna volta a seguir o Detalhes mais recente.
  clara.onTurnStart(() => setSelection({ type: "latest" }));

  // Follow-ups do turno (derivados do painel) na frente dos do servidor
  // (derivados do razão).
  const turnFollowups = useMemo(
    () =>
      deriveFollowups(
        // O follow-up acompanha o painel que está À VISTA, que é o último.
        presented.at(-1) ?? null,
        followups.length > 0 ? followups : FALLBACK_FOLLOWUPS,
      ),
    [presented, followups],
  );

  // `agent.reset()` aborta o stream em voo e limpa a tela; quem CRIA a sessão
  // nova é a remontagem (a sessão é nossa agora — ver `use-clara-agent`), então
  // as duas chamadas andam juntas.
  const startNewConversation = () => {
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

  useEffect(() => {
    window.dispatchEvent(new Event("clara:conversation-updated"));
  }, [agent.status, conversations.length]);

  const conversationTitle = useMemo(() => {
    const raw = conversations.find((entry) => entry.sessionId === agent.session.sessionId)?.title;
    if (raw === undefined || raw.trim() === "") return "Sua conversa";
    if (/fatura|nubank|extrato|\.pdf/i.test(raw)) return "Fatura de junho";
    if (/compar/i.test(raw)) return "Comparação mensal";
    return raw;
  }, [agent.session.sessionId, conversations]);

  return (
    <div className={`clara-chat-layout ${active !== null ? "with-details" : ""}`}>
      {/* A coluna central mantém o contexto e o composer no mesmo eixo visual. */}
      <div className="clara-chat-column">
        {!isWelcome ? (
          // O invólucro reserva a mesma calha de barra de rolagem que o
          // scroller da conversa (ver `.clara-chat-measure`), para o título
          // começar exatamente onde o texto das mensagens começa.
          <div className="clara-chat-measure">
            <header className="clara-chat-heading">
              <p className="clara-eyebrow">Assistente financeiro</p>
              <span className="clara-context-status"><i aria-hidden="true" /> Contexto atualizado</span>
              <h1 className="clara-chat-title">{conversationTitle}</h1>
            </header>
          </div>
        ) : null}

        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="clara-conversation-content space-y-8 px-0 pb-8 pt-0">
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

            {agent.data.messages.map((message) => {
              const linked = messageArtifacts.get(message.id);
              const artifactLabel =
                linked?.kind === "batch" || linked?.kind === "batchHistory"
                  ? "Ver conferência da fatura"
                  : linked?.kind === "view" && linked.views.at(-1)?.kind === "proposal"
                    ? "Ver proposta"
                    : linked?.kind === "view" && linked.views.at(-1)?.kind === "checksum"
                      ? "Ver detalhes da conferência"
                      : "Ver detalhes";
              return (
                <ChatMessage
                  key={message.id}
                  message={message}
                  hasArtifact={message.role !== "user" && linked !== undefined}
                  artifactLabel={artifactLabel}
                  onOpenArtifact={() => openArtifact(message.id)}
                />
              );
            })}

            {!isWelcome ? <ExecutionTrace activity={activity} busy={busy} /> : null}

            {/* O painel foi pedido e recusado pelo contrato. A resposta em
                texto normalmente aponta para ele ("veja ao lado"), e ficar
                calado deixa a pessoa procurando o que não existe. Dizer que
                não deu, e o que dá para fazer, é o mínimo honesto. */}
            {panelFailed && !busy ? (
              <p className="clara-small">
                Não consegui montar o painel desta resposta — os números acima
                seguem válidos. Se quiser vê-los organizados, peça de novo em
                outras palavras.
              </p>
            ) : null}

            {/* A decisão sobre o lote vem PRIMEIRO e dentro da conversa: é o
                momento em que a pessoa decide. */}
            {pending !== null && pending.toolName !== "ask_question" && answered === null ? (
              <DecisionCard
                pending={pending}
                proposal={pendingProposal}
                actionProposal={pendingActionProposal}
                disabled={busy}
                onAnswer={clara.answer}
              />
            ) : pending?.toolName === "ask_question" && answered === null ? (
              <GenericPrompt
                pending={pending}
                disabled={busy}
                onAnswer={clara.answer}
                onAnswerText={clara.answerText}
              />
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

            {/*
              O upload acontece ANTES de existir turno, então o `ExecutionTrace`
              — que é derivado de eventos reais e não inventa progresso — não tem
              o que mostrar. Sem esta linha, enviar uma fatura (o caso de uso
              principal) dava como feedback um número de 10px dentro do botão de
              anexo, com a tela ainda mostrando as sugestões de boas-vindas.
            */}
            {uploadingName !== null ? (
              <div className="clara-message-row">
                <p className="clara-queued">
                  Lendo <strong>{uploadingName}</strong>
                  <small>
                    {progress === null ? "preparando o documento…" : `enviando · ${progress}%`}
                  </small>
                </p>
              </div>
            ) : null}

            {/*
              As mensagens que a pessoa escreveu enquanto a Clara trabalhava.
              Elas ficavam invisíveis: o campo esvaziava e o único sinal era um
              texto de 12px no rodapé, que o CSS esconde em telas estreitas. No
              celular, escrever durante um turno parecia não fazer nada.
              Desenhá-las aqui devolve o que a pessoa escreveu ao lugar onde ela
              espera vê-lo.
            */}
            {queuedMessages.map((texto, indice) => (
              <div key={`fila-${indice}`} className="clara-message-row opacity-60">
                <p className="clara-queued">
                  {texto}
                  <small>aguardando a Clara terminar</small>
                </p>
              </div>
            ))}

            {agent.error ? (
              /*
               * Um erro precisa SEMPRE ter uma saída clicável.
               *
               * Antes, a mensagem crua do eve ia para a tela — em inglês, escrita
               * para depurar — e o botão de recomeçar só aparecia quando havia
               * conversa retomada (`initial !== null`). Numa conversa NOVA que
               * falhava não havia botão nenhum: só um texto âmbar, e nada a
               * fazer além de recarregar a página sem que nada dissesse isso.
               */
              <div className="clara-card space-y-4 p-5">
                <p className="text-[var(--clara-amber)]">{mensagemDeErro(agent.error.message)}</p>
                <div className="flex flex-wrap gap-2">
                  {lastUserText !== null ? (
                    <button type="button" onClick={retry} className="clara-pill h-8 px-4 text-xs">
                      Tentar de novo
                    </button>
                  ) : null}
                  {/* Recomeçar é o caminho honesto quando a sessão morreu de
                      vez: o razão está no banco; o que se perde é o fio da
                      conversa. */}
                  <button
                    type="button"
                    onClick={startNewConversation}
                    className="clara-pill clara-pill-outline h-8 px-4 text-xs"
                  >
                    Começar nova conversa
                  </button>
                </div>
              </div>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="clara-composer-wrap">
            {/* `items-end`, não `items-center`: o campo cresce com o conteúdo
                (até ~6 linhas, depois rola por dentro), e os botões ficam
                ancorados na base — centralizados, eles flutuariam no meio de
                um campo alto.

                Duas formas, uma marcação: no celular a caixa quebra em duas
                linhas (campo em cima, botões embaixo, `justify-between`), e a
                partir de `sm` volta a ser a linha única do desktop. Numa tela
                de 360px os três itens lado a lado não caberiam — o texto do
                placeholder quebrava e sobrava tarja azul por cima da borda. A
                ordem visual é dada por `order-*`, não pela ordem no DOM. */}
            <PromptInput
              className="flex-wrap items-end justify-between gap-y-1 rounded-[var(--clara-radius-card)] p-1.5 sm:flex-nowrap sm:justify-start sm:py-1.5 sm:pl-2 sm:pr-1.5"
              onSubmit={(message, event) => {
                event.preventDefault();
                const text = message.text?.trim();
                if (text === undefined || text === "" || sendLocked) return;
                clara.send(text);
              }}
            >
              <InputGroupAddon align="inline-start" className="order-2 sm:order-first">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={navigationLocked}
                  aria-label="Anexar fatura em PDF"
                  className="mb-1 grid size-8 place-items-center rounded-[var(--clara-radius-pill)] bg-transparent text-[var(--clara-ink)] leading-none transition-colors hover:bg-[var(--clara-yellow)] disabled:opacity-50"
                >
                  {/* Uma fatura de 20 MB agora sobe inteira, então a espera
                      precisa ter número: "…" cobre o hash, o parser e o
                      registro; a porcentagem, o trecho que demora. */}
                  {uploading ? (
                    progress === null ? (
                      "…"
                    ) : (
                      <span className="text-[10px] font-medium tabular-nums">{progress}</span>
                    )
                  ) : (
                    <Paperclip className="size-4" aria-hidden="true" />
                  )}
                </button>
              </InputGroupAddon>
              <PromptInputBody>
                <PromptInputTextarea
                  placeholder="Pergunte sobre seus gastos ou envie um documento"
                  // Digitar não espera o upload: só o envio depende do servidor.
                  disabled={sendLocked}
                  rows={1}
                  className="order-1 min-h-11 basis-full px-3 py-2.5 sm:order-none sm:basis-0"
                />
              </PromptInputBody>
              <InputGroupAddon align="inline-end" className="order-3 sm:order-last">
                {/* "Parar" interrompe o TURNO, não o stream. `agent.stop()`
                    só descolava o cliente: a Clara seguia rodando — e
                    cobrando — do outro lado, e o botão dizia o contrário. Agora
                    é `session.cancel({ turnId })`, e a espera é honesta: o
                    stream fica aberto até a fronteira do cancelamento
                    (`turn.cancelled` → `session.waiting`), que é o que devolve
                    o botão para "Enviar". No instante em que o turno ainda não
                    anunciou seu id (`submitted`), não há o que cancelar e o
                    botão fica inerte em vez de prometer o que não cumpre. */}
                <PromptInputSubmit
                  status={agent.status === "error" ? "ready" : agent.status}
                  onStop={() => clara.cancel()}
                  disabled={sendLocked && !busy ? true : busy && !canCancel}
                  size="sm"
                  className="clara-pill clara-pill-primary mb-0.5 size-10 min-h-10 w-10 p-0 text-sm"
                >
                  {busy ? (cancelling ? "…" : "■") : <Send className="size-4" aria-hidden="true" />}
                </PromptInputSubmit>
              </InputGroupAddon>
            </PromptInput>
            {/* Só o que a pessoa não consegue ver sozinha.
                "A Clara está trabalhando" saiu daqui: o botão já virou "parar",
                a trilha de execução já mostra o passo e a resposta já está
                aparecendo — dizer de novo, embaixo, é legenda de algo que a
                tela inteira estava contando. O que sobra é o que não tem outra
                fonte: quantas mensagens esperam a vez, e que uma decisão em
                aberto não bloqueia continuar escrevendo. */}
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {queuedMessages.length > 0
                ? `${queuedMessages.length} mensagem${queuedMessages.length === 1 ? "" : "ns"} aguardando a Clara terminar.`
                : pending !== null && answered === null
                  ? "Você pode continuar escrevendo; a decisão ficará aguardando no cartão acima."
                  : ""}
            </p>
        </div>
      </div>

      {/* Mesmo conteúdo de Detalhes, duas molduras: coluna fixa no desktop e modal em
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
  onAnswerText,
}: {
  pending: NonNullable<ReturnType<typeof findPendingRequest>>;
  disabled: boolean;
  onAnswer: (optionId: string) => void;
  onAnswerText: (text: string, sensitive?: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const options = pending.options ?? [];
  const sensitive = /senha|password/i.test(pending.prompt ?? "");
  const allowText = pending.allowFreeform === true || options.length === 0;

  return (
    <section className="clara-card p-7">
      <p className="clara-display-xs">
        {pending.prompt ?? "A Clara precisa da sua confirmação."}
      </p>
      {options.length > 0 ? (
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
      ) : null}
      {allowText ? (
        <form
          className="mt-5 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const answer = value.trim();
            if (answer === "" || disabled) return;
            onAnswerText(answer, sensitive);
          }}
        >
          <label className="clara-small" htmlFor={`answer-${pending.requestId}`}>
            {sensitive ? "Senha do documento" : "Sua resposta"}
          </label>
          <input
            id={`answer-${pending.requestId}`}
            type={sensitive ? "password" : "text"}
            autoComplete={sensitive ? "off" : undefined}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={disabled}
            className="h-11 rounded-[var(--clara-radius-tile)] border bg-background px-3 text-base"
          />
          <button
            type="submit"
            disabled={disabled || value.trim() === ""}
            className="clara-pill clara-pill-primary h-10 self-start px-5 text-sm disabled:opacity-50"
          >
            {sensitive ? "Ler documento" : "Enviar resposta"}
          </button>
          {sensitive ? (
            <p className="clara-small">
              A senha não aparece na conversa nem é guardada no histórico deste dispositivo.
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
