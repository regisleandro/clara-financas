"use client";

import { useEveAgent } from "eve/react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { ReviewCard, type ReviewCardData } from "@/components/review-card";
import { findLatestBatchProposal, findPendingRequest } from "@/lib/input-request";

/**
 * A conversa.
 *
 * Cross-origin por construção: o navegador fala DIRETO com a instância do
 * tenant, não com o control plane. O bearer vem de /api/token, que deriva o
 * tenantId da sessão autenticada — nunca do cliente.
 *
 * No design, a resposta da Clara é tipografia grande, não balão: ela é a voz
 * do sistema, e balão a colocaria no mesmo plano da pessoa. Só a fala do
 * usuário recebe balão, escuro e alinhado à direita.
 */

const STARTERS = [
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
] as const;

export function Chat({ agentHost }: { agentHost: string }) {
  const tokenRef = useRef<{ value: string; expiresAt: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const busy = agent.status === "submitted" || agent.status === "streaming";

  const pending = findPendingRequest(agent.data.messages);
  const proposal = findLatestBatchProposal(agent.data.messages);
  const isWelcome = agent.data.messages.length === 0;

  function answer(optionId: string) {
    if (!pending) return;
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

      await agent.send({
        message: `Enviei o documento ${file.name} (documentId: ${data.documentId}). Extraia as transações e me mostre a conferência.`,
      });
    } finally {
      setUploading(false);
    }
  }

  const reviewData: ReviewCardData | null =
    pending?.toolName === "commit_batch" && proposal
      ? {
          batchId: String(proposal.batchId),
          transactionCount: Number(proposal.transactionCount ?? 0),
          issuer: typeof proposal.issuer === "string" ? proposal.issuer : null,
          checksum: proposal.checksum as ReviewCardData["checksum"],
        }
      : null;

  return (
    <div className="flex min-h-[calc(100svh-3rem)] flex-col">
      <div className="mx-auto w-full max-w-[720px] flex-1 px-6 pb-52 pt-16">
        <header className="mb-12 flex items-center gap-3">
          <span className="grid size-[31px] shrink-0 place-items-center rounded-[10px] bg-[var(--clara-ink)]">
            <svg width="19" height="19" viewBox="0 0 12 12" aria-hidden="true">
              <circle cx="6" cy="6" r="4.7" fill="none" stroke="#f5f5f7" strokeWidth="1.2" />
              <circle cx="6" cy="6" r="1.7" fill="#f5f5f7" />
            </svg>
          </span>
          <span>
            <strong className="clara-display-xs block">Clara</strong>
            <small className="clara-small block">Assistente financeiro · sessão ativa</small>
          </span>
          {!isWelcome ? (
            <button
              type="button"
              onClick={() => agent.reset()}
              className="ml-auto rounded-[var(--clara-radius-pill)] bg-[var(--clara-ash)] px-4 py-2 text-xs"
              style={{ letterSpacing: "-0.022em" }}
            >
              Nova conversa
            </button>
          ) : null}
        </header>

        {isWelcome ? (
          <div>
            <h1 className="clara-display-lg text-pretty">
              Oi. O que fazemos com o seu dinheiro agora?
            </h1>
            <p className="clara-lead mb-12 mt-6">
              Posso organizar documentos, explicar seus gastos ou cuidar de um compromisso. Os
              cálculos são verificados e nada é salvo sem sua aprovação.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {STARTERS.map((starter) => (
                <button
                  key={starter.title}
                  type="button"
                  disabled={busy || uploading}
                  onClick={() => {
                    if (starter.prompt === null) fileRef.current?.click();
                    else void agent.send({ message: starter.prompt });
                  }}
                  className="clara-card flex flex-col gap-2 p-7 text-left transition-colors hover:bg-[#fbfbfd] disabled:opacity-60"
                >
                  <strong className="clara-display-xs">{starter.title}</strong>
                  <small className="clara-small">{starter.note}</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-8">
          {agent.data.messages.map((message) => {
            const text = message.parts
              .map((part) => (part.type === "text" ? part.text : ""))
              .join("")
              .trim();
            if (text === "") return null;

            if (message.role === "user") {
              return (
                <div key={message.id} className="flex justify-end">
                  <p className="max-w-[78%] rounded-[22px_22px_8px_22px] bg-[var(--clara-ink)] px-[19px] py-[13px] text-[var(--clara-white)]">
                    {text}
                  </p>
                </div>
              );
            }

            return (
              <p key={message.id} className="clara-display-sm whitespace-pre-wrap text-pretty">
                {text}
              </p>
            );
          })}

          {busy ? (
            <div className="flex gap-1.5" aria-label="Clara está pensando">
              {[0, 0.15, 0.3].map((delay) => (
                <i
                  key={delay}
                  className="block size-[7px] rounded-full bg-[var(--clara-ink)]"
                  style={{ animation: `clara-dots 1s ${delay}s infinite` }}
                />
              ))}
            </div>
          ) : null}

          {reviewData ? (
            <ReviewCard
              data={reviewData}
              disabled={busy}
              onApprove={() => answer("approve")}
              onReject={() => answer("deny")}
            />
          ) : null}

          {pending && !reviewData ? (
            <GenericPrompt pending={pending} disabled={busy} onAnswer={answer} />
          ) : null}

          {agent.error ? (
            <p className="clara-card p-5 text-[var(--clara-amber)]">{agent.error.message}</p>
          ) : null}
        </div>
      </div>

      <div
        className="sticky bottom-0 px-6 pb-8"
        style={{
          background:
            "linear-gradient(to top, var(--clara-fog) 62%, rgb(245 245 247 / 0))",
        }}
      >
        <div className="mx-auto max-w-[720px]">
          <form
            className="clara-card flex items-center gap-3 py-2 pl-6 pr-2"
            onSubmit={(event) => {
              event.preventDefault();
              const message = draft.trim();
              if (message === "" || busy) return;
              setDraft("");
              void agent.send({ message });
            }}
          >
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || busy}
              aria-label="Enviar fatura em PDF"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--clara-fog)] disabled:opacity-50"
            >
              {uploading ? "…" : "+"}
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
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy}
              placeholder="Pergunte sobre seu dinheiro…"
              className="flex-1 border-0 bg-transparent py-3.5 outline-none"
            />
            <button
              type="submit"
              disabled={busy || draft.trim() === ""}
              className="clara-pill clara-pill-primary disabled:opacity-40"
            >
              Enviar
            </button>
          </form>
          <p className="clara-small mt-3 text-center">
            Os cálculos vêm de ferramentas verificáveis · nada é registrado sem sua aprovação.
          </p>
        </div>
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
      <div className="mt-5 flex flex-wrap gap-2">
        {options.map((option, index) => {
          const id = option.optionId ?? option.id ?? String(index);
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => onAnswer(id)}
              className="clara-pill clara-pill-outline disabled:opacity-40"
            >
              {option.label ?? id}
            </button>
          );
        })}
      </div>
    </section>
  );
}
