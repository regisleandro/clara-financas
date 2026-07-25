"use client";

import { useEveAgent } from "eve/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { InputGroupAddon } from "@/components/ui/input-group";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { ChatHeader, ChatWelcome, type Starter } from "@/components/chat-welcome";
import { ExecutionTrace } from "@/components/execution-trace";
import { ReviewCard, type ReviewCardData } from "@/components/review-card";
import { deriveActivity } from "@/lib/activity";
import { findLatestBatchProposal, findPendingRequest } from "@/lib/input-request";

/**
 * A conversa.
 *
 * Cross-origin por construção: o navegador fala DIRETO com a instância do
 * tenant. O bearer vem de /api/token, que deriva o tenantId da sessão
 * autenticada — nunca do cliente.
 *
 * Os elementos ricos são AI Elements:
 *   Execução desta resposta → Task
 *   Cartão de conferência   → Artifact + Confirmation
 *   Continuar               → Suggestions
 *   Mensagens e composer    → Conversation, Message, PromptInput
 */

const STARTERS: readonly Starter[] = [
  {
    title: "Enviar um documento",
    note: "Fatura, extrato ou nota fiscal em PDF",
    prompt: null,
  },
  {
    title: "Analisar meus gastos",
    note: "Compare períodos, categorias e recorrências",
    prompt: "Por que meus gastos mudaram? Compare os períodos que existem no razão.",
  },
  {
    title: "Encontrar recorrências",
    note: "O que repete todo mês e o que já não uso",
    prompt: "O que está repetindo todo mês? Mostre o custo anual de cada uma.",
  },
  {
    title: "Cuidar de um prazo",
    note: "Lembretes de vencimento antes da preocupação",
    prompt: "Quais compromissos estão por vencer?",
  },
];

const FOLLOWUPS = [
  "Detalhar por categoria",
  "Comparar com o período anterior",
  "O que repete todo mês?",
];

export function Chat({ agentHost, name }: { agentHost: string; name: string | null }) {
  const tokenRef = useRef<{ value: string; expiresAt: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [answered, setAnswered] = useState<boolean | null>(null);
  const [uploading, setUploading] = useState(false);

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
  const proposal = findLatestBatchProposal(agent.data.messages);
  const isWelcome = agent.data.messages.length === 0;

  function send(message: string) {
    setAnswered(null);
    void agent.send({ message });
  }

  function answer(optionId: string) {
    if (!pending) return;
    setAnswered(optionId === "approve");
    void agent.send({ inputResponses: [{ requestId: pending.requestId, optionId }] });
  }

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

  const reviewData: ReviewCardData | null = proposal
    ? {
        batchId: String(proposal.batchId),
        transactionCount: Number(proposal.transactionCount ?? 0),
        issuer: typeof proposal.issuer === "string" ? proposal.issuer : null,
        checksum: proposal.checksum as ReviewCardData["checksum"],
      }
    : null;

  const showReview =
    reviewData !== null && (pending?.toolName === "commit_batch" || answered !== null);

  return (
    <div className="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-[720px] flex-col px-6">
      <Conversation className="flex-1">
        <ConversationContent className="space-y-8 px-0 pb-8 pt-16">
          <ChatHeader onReset={isWelcome ? null : () => agent.reset()} />

          {isWelcome ? (
            <ChatWelcome
              name={name}
              starters={STARTERS}
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
            if (text === "") return null;

            return (
              <Message key={message.id} from={message.role}>
                <MessageContent>{text}</MessageContent>
              </Message>
            );
          })}

          {!isWelcome ? <ExecutionTrace activity={activity} /> : null}

          {showReview && reviewData !== null ? (
            <ReviewCard
              data={reviewData}
              disabled={busy}
              answered={answered}
              onApprove={() => answer("approve")}
              onReject={() => answer("deny")}
            />
          ) : null}

          {pending && !showReview ? (
            <GenericPrompt pending={pending} disabled={busy} onAnswer={answer} />
          ) : null}

          {!isWelcome && !busy && pending === null ? (
            <div>
              <p className="clara-eyebrow mb-3">Continuar</p>
              <Suggestions>
                {FOLLOWUPS.map((followup) => (
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

      <div className="sticky bottom-0 bg-background pb-8 pt-2">
        <PromptInput
          className="items-center rounded-[var(--clara-radius-card)] py-1.5 pl-4 pr-1.5"
          onSubmit={(message, event) => {
            event.preventDefault();
            const text = message.text?.trim();
            if (text === undefined || text === "" || busy) return;
            send(text);
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea
              placeholder="Pergunte sobre seu dinheiro…"
              disabled={busy}
              rows={1}
              className="min-h-11 py-2.5"
            />
          </PromptInputBody>
          {/* inline-end, e não o PromptInputFooter: o rodapé é um addon
              block-end e empilharia uma segunda linha. O design tem uma só. */}
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

      {/* Fora do formulário: o seletor é acionado tanto pelo card de boas-vindas
          quanto pelo botão do composer. */}
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
