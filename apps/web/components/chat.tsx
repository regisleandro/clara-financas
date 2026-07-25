"use client";

import { useEveAgent } from "eve/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { ExecutionTrace } from "@/components/execution-trace";
import { ReviewCard, type ReviewCardData } from "@/components/review-card";
import { deriveActivity } from "@/lib/activity";
import { findLatestBatchProposal, findPendingRequest } from "@/lib/input-request";

/**
 * A conversa, sobre os componentes do AI Elements.
 *
 * Cross-origin por construção: o navegador fala DIRETO com a instância do
 * tenant. O bearer vem de /api/token, que deriva o tenantId da sessão
 * autenticada — nunca do cliente.
 *
 * Os três elementos ricos do design são AI Elements de verdade:
 *   Execução desta resposta → Task
 *   Cartão de conferência   → Artifact + Confirmation
 *   Continuar               → Suggestions
 */

const STARTERS = [
  "Por que meus gastos mudaram? Compare os períodos do razão.",
  "O que está repetindo todo mês? Mostre o custo anual.",
  "Onde eu mais gastei? Mostre por categoria.",
  "Quais compromissos estão por vencer?",
] as const;

export function Chat({ agentHost }: { agentHost: string }) {
  const tokenRef = useRef<{ value: string; expiresAt: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [answered, setAnswered] = useState<boolean | null>(null);

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

  const [uploading, setUploading] = useState(false);
  const busy = agent.status === "submitted" || agent.status === "streaming";

  const activity = useMemo(() => deriveActivity(agent.events), [agent.events]);
  const pending = findPendingRequest(agent.data.messages);
  const proposal = findLatestBatchProposal(agent.data.messages);
  const isWelcome = agent.data.messages.length === 0;

  function answer(optionId: string) {
    if (!pending) return;
    setAnswered(optionId === "approve");
    void agent.send({ inputResponses: [{ requestId: pending.requestId, optionId }] });
  }

  function send(message: string) {
    setAnswered(null);
    void agent.send({ message });
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

  const showReview = reviewData !== null && (pending?.toolName === "commit_batch" || answered !== null);

  return (
    <div className="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-[720px] flex-col px-6">
      <Conversation className="flex-1">
        <ConversationContent className="pb-8 pt-16">
          {isWelcome ? (
            <ConversationEmptyState
              title="Oi. O que fazemos com o seu dinheiro agora?"
              description="Posso organizar documentos, explicar seus gastos ou cuidar de um compromisso. Os cálculos vêm de ferramentas verificáveis e nada é salvo sem sua aprovação."
            >
              <Suggestions>
                {STARTERS.map((starter) => (
                  <Suggestion key={starter} suggestion={starter} onClick={send} />
                ))}
              </Suggestions>
            </ConversationEmptyState>
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

          {/* Execução desta resposta */}
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
            <Suggestions>
              {STARTERS.slice(0, 3).map((starter) => (
                <Suggestion key={starter} suggestion={starter} onClick={send} />
              ))}
            </Suggestions>
          ) : null}

          {agent.error ? (
            <p className="clara-card p-5 text-[var(--clara-amber)]">{agent.error.message}</p>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="sticky bottom-0 pb-8">
        <PromptInput
          onSubmit={(message, event) => {
            event.preventDefault();
            const text = message.text?.trim();
            if (text === undefined || text === "" || busy) return;
            send(text);
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea placeholder="Pergunte sobre seu dinheiro…" disabled={busy} />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || busy}
                className="clara-chip disabled:opacity-50"
              >
                {uploading ? "Enviando…" : "+ Fatura"}
              </button>
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
            </PromptInputTools>
            <PromptInputSubmit status={agent.status} />
          </PromptInputFooter>
        </PromptInput>
        <p className="clara-small mt-3 text-center">
          Os cálculos vêm de ferramentas verificáveis · nada é registrado sem sua aprovação.
        </p>
      </div>
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
