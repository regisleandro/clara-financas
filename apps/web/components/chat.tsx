"use client";

import { useEveAgent } from "eve/react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { ReviewCard, type ReviewCardData } from "@/components/review-card";
import { findLatestBatchProposal, findPendingRequest } from "@/lib/input-request";

/**
 * Conversa com a instância do agente.
 *
 * Cross-origin por construção: o navegador fala DIRETO com a instância do
 * tenant, não com o control plane. O bearer vem de /api/token, que deriva o
 * tenantId da sessão autenticada — nunca do cliente. Do outro lado, a
 * instância confere o claim contra o próprio TENANT_ID.
 */
export function Chat({ agentHost }: { agentHost: string }) {
  const tokenRef = useRef<{ value: string; expiresAt: number } | null>(null);

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
    <div className="flex min-h-[60vh] flex-col">
      <div className="flex-1 space-y-6">
        {agent.data.messages.length === 0 ? (
          <p className="text-muted-foreground">
            Envie uma fatura em PDF ou pergunte alguma coisa sobre seus gastos.
          </p>
        ) : null}

        {agent.data.messages.map((message) => (
          <article key={message.id} className="space-y-1">
            <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">
              {message.role === "user" ? "VOCÊ" : "CLARA"}
            </p>
            {message.parts.map((part, index) =>
              part.type === "text" ? (
                <p key={index} className="leading-relaxed whitespace-pre-wrap">
                  {part.text}
                </p>
              ) : null,
            )}
          </article>
        ))}

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
          <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {agent.error.message}
          </p>
        ) : null}
      </div>

      <form
        className="sticky bottom-0 flex gap-2 border-t bg-background py-4"
        onSubmit={(event) => {
          event.preventDefault();
          const message = draft.trim();
          if (message.length === 0 || busy) return;
          setDraft("");
          void agent.send({ message });
        }}
      >
        <label className="inline-flex h-12 cursor-pointer items-center justify-center rounded-full border border-border px-5 text-sm font-medium transition-colors hover:bg-secondary">
          {uploading ? "Enviando…" : "Fatura"}
          <input
            type="file"
            accept="application/pdf"
            className="sr-only"
            disabled={uploading || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={busy}
          placeholder="Pergunte alguma coisa…"
          className="h-12 flex-1 rounded-full border border-border bg-background px-5 text-[15px] outline-none focus-visible:border-ring disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || draft.trim().length === 0}
          className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-6 text-[15px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Enviando…" : "Enviar"}
        </button>
      </form>
    </div>
  );
}

/**
 * Aprovação genérica e `ask_question` — inclusive o pedido de senha do PDF,
 * que o protótipo desenha com "Só desta vez" / "Continuar".
 */
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
    <section className="rounded-2xl border bg-card p-6">
      <p className="leading-relaxed">{pending.prompt ?? "A Clara precisa da sua confirmação."}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {options.map((option, index) => {
          const id = option.optionId ?? option.id ?? String(index);
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => onAnswer(id)}
              className="inline-flex h-11 items-center justify-center rounded-full border px-5 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-40"
            >
              {option.label ?? id}
            </button>
          );
        })}
      </div>
    </section>
  );
}
