"use client";

import { useEveAgent } from "eve/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { InputGroupAddon } from "@/components/ui/input-group";
import {
  ArtifactAside,
  ArtifactLink,
  ArtifactModal,
  type ActiveArtifact,
} from "@/components/artifact-surface";
import { ChatHeader, ChatWelcome, type Starter } from "@/components/chat-welcome";
import { DecisionCard } from "@/components/decision-card";
import { ExecutionTrace } from "@/components/execution-trace";
import { deriveActivity } from "@/lib/activity";
import { batchArtifact, type BatchProposal } from "@/lib/artifact";
import { useMediaQuery } from "@/lib/use-media-query";
import type { View } from "@clara-financas/views";
import { findOpenBatchProposalLocation, findPendingRequest } from "@clara-financas/views/hitl";
import { findMessageView, findPresentedView } from "@clara-financas/views/stream";

/**
 * A conversa, em duas colunas.
 *
 * O artefato abre à DIREITA, fixo, e a conversa segue ao lado — é assim no
 * protótipo, e a razão é de uso: o artefato é consultado enquanto se decide.
 * Embutido no fluxo, ele rola para fora da tela justamente quando é preciso.
 *
 * Elementos do AI Elements: Conversation, Message + MessageResponse (markdown
 * via Streamdown), PromptInput, Task (trace), Artifact (painel), Suggestions.
 */

/**
 * Atalhos e follow-ups chegam PRONTOS do servidor, derivados do razão.
 *
 * Eram constantes aqui, iguais em todo estado — e duas delas eram becos sem
 * saída para quem tem uma fatura só: comparar com um período anterior que não
 * existe, procurar recorrência sem intervalo a medir. Um atalho que não pode
 * funcionar ensina que a ferramenta não responde.
 *
 * O fallback cobre só o caso de o razão estar vazio ou a carga falhar; com ele
 * a tela nunca fica sem a única ação que sempre funciona.
 */
const FALLBACK_STARTERS: readonly Starter[] = [
  { title: "Enviar um documento", note: "Fatura, extrato ou nota fiscal em PDF", prompt: null },
];

const FALLBACK_FOLLOWUPS = ["Detalhar por categoria"];

export function Chat({
  agentHost,
  name,
  starters,
  followups,
}: {
  agentHost: string;
  name: string | null;
  starters: readonly Starter[];
  followups: readonly string[];
}) {
  const tokenRef = useRef<{ value: string; expiresAt: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [answered, setAnswered] = useState<boolean | null>(null);
  const [uploading, setUploading] = useState(false);

  /**
   * Qual artefato está aberto na tela, ou `null` (fechado).
   *
   * `latest` = o mais recente (a coluna reabre sozinha quando a Clara produz um
   * artefato novo). `view`/`batch` = o de UMA resposta específica, aberto pelo
   * link que a acompanha. Guardar uma referência, e não o conteúdo, mantém o
   * painel reativo: se o lote é registrado ou a conversa é reiniciada, o alvo
   * some e o painel fecha sozinho.
   */
  const [selection, setSelection] = useState<
    { type: "latest" } | { type: "batch" } | { type: "view"; id: string } | null
  >(null);

  // No celular o artefato é uma modal; no desktop, a coluna fixa à direita. O
  // Radix trava a rolagem de fundo mesmo com o conteúdo escondido por CSS, então
  // a modal só pode MONTAR aberta abaixo de `lg`.
  const isDesktop = useMediaQuery("(min-width: 1024px)");

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

  const agent = useEveAgent({ host: agentHost, auth: { bearer } });

  const busy = agent.status === "submitted" || agent.status === "streaming";
  const activity = useMemo(() => deriveActivity(agent.events), [agent.events]);
  const pending = findPendingRequest(agent.data.messages);
  const isWelcome = agent.data.messages.length === 0;

  // Reatribuídos a cada render: o `useMemo` do artefato guardaria a versão
  // antiga de `agent` se chamasse as funções direto, e o clique dispararia
  // contra uma sessão que já não é a corrente.
  const sendRef = useRef<(message: string) => void>(() => {});
  const answerRef = useRef<(optionId: string) => void>(() => {});
  answerRef.current = (optionId: string) => {
    if (!pending) return;
    setAnswered(optionId === "approve");
    void agent.send({ inputResponses: [{ requestId: pending.requestId, optionId }] });
  };

  function send(message: string) {
    setAnswered(null);
    // Turno novo: a coluna volta a seguir o artefato mais recente.
    setSelection({ type: "latest" });
    void agent.send({ message });
  }
  sendRef.current = send;

  async function upload(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/documents", { method: "POST", body });
      const data = (await response.json()) as { documentId?: string; error?: string };

      if (!response.ok || !data.documentId) {
        toast.error(data.error ?? "Não foi possível enviar o arquivo.");
        return;
      }

      send(
        `Enviei o documento ${file.name} (documentId: ${data.documentId}). Extraia as transações e me mostre a conferência.`,
      );
    } finally {
      setUploading(false);
    }
  }

  // `findOpenBatchProposalLocation` some assim que o lote é registrado. Antes o
  // cartão sobrevivia ao commit, continuando a oferecer "Registrar fatura" sobre
  // algo que já entrou no razão — pior que um botão inútil, porque sugere que
  // nada aconteceu e convida a registrar de novo. O `messageId` diz em qual
  // resposta pendurar o link "Ver artefato".
  const proposalLocation = useMemo(
    () => findOpenBatchProposalLocation(agent.data.messages),
    [agent.data.messages],
  );
  const proposal = (proposalLocation?.output ?? null) as BatchProposal | null;
  const canApprove = pending?.toolName === "commit_batch" && answered === null;

  /**
   * O painel que a CLARA mandou desenhar, lido do stream.
   *
   * Substitui a inferência que existia aqui — o frontend olhava o retorno das
   * ferramentas do analista e adivinhava um painel. Adivinhação errava nos dois
   * sentidos: montava painel quando a resposta era uma pergunta, e não montava
   * nada quando o formato do retorno mudava.
   */
  const presented = useMemo(() => findPresentedView(agent.events), [agent.events]);

  /**
   * A conferência de um lote é a exceção que continua sendo derivada aqui: ela
   * precisa carregar os botões do gate, e esses botões são estado do cliente
   * (`answerRef`), não algo que a Clara possa mandar no payload.
   *
   * O botão NUNCA fica morto. Antes ele dependia de existir uma aprovação
   * pendente de `commit_batch` — e quando a Clara terminava a conferência sem
   * chamar a ferramenta, oferecendo o próximo passo em texto, a pessoa ficava
   * olhando um lote conferido com um botão cinza e nenhum caminho à frente.
   *
   * As instruções já mandavam chamar a ferramenta, e ainda assim aconteceu.
   * Instrução não é garantia: quando o modelo não abre o gate, o clique pede
   * que ele abra. A decisão auditada continua sendo a do gate — isto aqui só
   * garante que sempre exista um jeito de chegar até ele.
   */
  const artifact = useMemo(() => {
    if (proposal === null) return null;
    return batchArtifact(proposal, {
      onApprove: () =>
        canApprove
          ? answerRef.current("approve")
          : sendRef.current(`Registre o lote ${proposal.batchId} no razão.`),
      onReject: () =>
        canApprove
          ? answerRef.current("deny")
          : sendRef.current(
              `Descarte o lote ${proposal.batchId}. Não quero registrar essa fatura.`,
            ),
      // `answered !== null` cobre a janela entre o clique e o resultado: a
      // decisão já foi enviada, e um segundo clique ali pediria o registro de
      // novo. O painel some sozinho quando o commit volta confirmado.
      disabled: busy || answered !== null,
      pendingGate: canApprove,
    });
  }, [proposal, busy, canApprove, answered]);

  /**
   * O artefato de CADA resposta, indexado pela mensagem que o produziu.
   *
   * É o que sustenta o link "Ver artefato" só onde há artefato: um painel
   * (`present_view`, lido das partes da mensagem) ou a conferência de um lote. A
   * conferência tem precedência quando as duas caem na mesma resposta — é ela
   * que carrega a decisão.
   */
  const messageArtifacts = useMemo(() => {
    const map = new Map<string, { kind: "view"; view: View } | { kind: "batch" }>();
    for (const message of agent.data.messages) {
      if (message.role === "user") continue;
      const view = findMessageView(message);
      if (view !== null) map.set(message.id, { kind: "view", view });
    }
    if (proposalLocation?.messageId != null && proposal !== null) {
      map.set(proposalLocation.messageId, { kind: "batch" });
    }
    return map;
  }, [agent.data.messages, proposalLocation?.messageId, proposal]);

  /**
   * O que a seleção aponta, resolvido para o conteúdo a desenhar — ou `null`,
   * que fecha painel e modal de uma vez. Reavaliar aqui é o que faz o painel
   * fechar sozinho quando o alvo deixa de existir (lote registrado, reset).
   */
  const active = useMemo<ActiveArtifact | null>(() => {
    if (selection === null) return null;
    const batch: ActiveArtifact | null = artifact !== null ? { kind: "batch", data: artifact } : null;
    if (selection.type === "batch") return batch;
    if (selection.type === "latest") {
      return batch ?? (presented !== null ? { kind: "view", view: presented } : null);
    }
    const found = messageArtifacts.get(selection.id);
    if (found === undefined) return null;
    return found.kind === "batch" ? batch : { kind: "view", view: found.view };
  }, [selection, artifact, presented, messageArtifacts]);

  // Painel novo reabre a coluna, seguindo o artefato mais recente: a pessoa
  // acabou de pedir algo que o produz.
  const openKey = artifact?.title ?? presented?.title ?? null;
  useEffect(() => {
    if (openKey !== null) setSelection({ type: "latest" });
  }, [openKey]);

  const panelOpen = active !== null;
  const openArtifact = (message: { id: string; role: string }) => {
    const found = messageArtifacts.get(message.id);
    if (found === undefined) return;
    setSelection(found.kind === "batch" ? { type: "batch" } : { type: "view", id: message.id });
  };

  return (
    <div className="flex">
      {/* Altura FIXA, não mínima: é o que dá à conversa uma caixa com fim,
          para ela rolar por dentro em vez de empurrar a página. E quem rola é
          esta coluna INTEIRA, não o miolo de 720px — senão a barra de rolagem
          nasce no meio da tela, encostada no texto. A largura de leitura é
          imposta por dentro, em cada faixa. */}
      <div className="flex h-[calc(100svh-3rem)] min-w-0 flex-1 flex-col">
        <div className="shrink-0 bg-background">
          <div className="mx-auto w-full max-w-[720px] px-6 pb-4 pt-8">
            <ChatHeader
              onReset={isWelcome ? null : () => agent.reset()}
              onToggleArtifact={
                !panelOpen && artifact === null && presented === null
                  ? null
                  : () => setSelection(panelOpen ? null : { type: "latest" })
              }
              artifactOpen={panelOpen}
            />
          </div>
        </div>

        {/* `min-h-0` é o que permite encolher abaixo do conteúdo: sem ele um
            filho flex cresce e a rolagem interna nunca acontece. */}
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-[720px] space-y-8 px-6 pb-8 pt-4">
              {isWelcome ? (
                <ChatWelcome
                  name={name}
                  starters={starters.length > 0 ? starters : FALLBACK_STARTERS}
                  disabled={busy || uploading}
                  onPick={(starter) => {
                    if (starter.prompt === null) fileRef.current?.click();
                    else send(starter.prompt);
                  }}
                />
              ) : null}

              {agent.data.messages.map((message) => {
                const text = message.parts
                  .map((part) => (part.type === "text" ? part.text : ""))
                  .join("")
                  .trim();
                // O link ACOMPANHA o artefato: só as respostas que têm um
                // aparecem com "Ver artefato" — e uma resposta que só desenhou um
                // painel, sem texto, ainda precisa do link para alcançá-lo.
                const hasArtifact = message.role !== "user" && messageArtifacts.has(message.id);
                if (text === "" && !hasArtifact) return null;

                return (
                  <Message key={message.id} from={message.role}>
                    <MessageContent>
                      {/* MessageResponse é o renderizador de markdown; texto
                          cru em MessageContent deixava `**negrito**` à mostra. */}
                      {text !== "" ? <MessageResponse>{text}</MessageResponse> : null}
                      {hasArtifact ? (
                        <ArtifactLink onOpen={() => openArtifact(message)} />
                      ) : null}
                    </MessageContent>
                  </Message>
                );
              })}

              {!isWelcome ? <ExecutionTrace activity={activity} busy={busy} /> : null}

              {/* A decisão sobre o lote vem PRIMEIRO e dentro da conversa: é o
                  momento em que a pessoa decide, e escondê-lo num painel
                  lateral foi o que travou o fluxo em uso real. */}
              {pending?.toolName === "commit_batch" && answered === null ? (
                <DecisionCard
                  pending={pending}
                  proposal={proposal}
                  disabled={busy}
                  onAnswer={(id) => answerRef.current(id)}
                />
              ) : pending && pending.toolName !== "commit_batch" ? (
                <GenericPrompt
                  pending={pending}
                  disabled={busy}
                  onAnswer={(id) => answerRef.current(id)}
                />
              ) : null}

              {!isWelcome && !busy && pending === null ? (
                <div>
                  <p className="clara-eyebrow mb-3">Continuar</p>
                  <Suggestions>
                    {(followups.length > 0 ? followups : FALLBACK_FOLLOWUPS).map((followup) => (
                      <Suggestion key={followup} suggestion={followup} onClick={send} />
                    ))}
                  </Suggestions>
                </div>
              ) : null}

              {agent.error ? (
                <p className="clara-card p-5 text-[var(--clara-amber)]">{agent.error.message}</p>
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
                send(text);
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
                <PromptInputSubmit
                  status={agent.status}
                  size="sm"
                  className="clara-pill clara-pill-primary h-10 w-auto px-5 text-sm"
                >
                  Enviar
                </PromptInputSubmit>
              </InputGroupAddon>
            </PromptInput>
          </div>
        </div>
      </div>

      {/* Mesmo artefato, duas molduras: coluna fixa à direita no desktop
          (escondida por CSS abaixo de `lg`) e modal em tela cheia no celular. */}
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
          if (file) void upload(file);
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
