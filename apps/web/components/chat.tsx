"use client";

import { useEveAgent } from "eve/react";
import { useCallback, useRef, useState } from "react";

/**
 * Conversa com a instância do agente.
 *
 * Cross-origin por construção: o navegador fala DIRETO com a instância do
 * tenant, não com o control plane. O bearer vem de /api/token, que deriva o
 * tenantId da sessão autenticada — nunca do cliente. Do outro lado, a
 * instância confere o claim contra o próprio TENANT_ID.
 *
 * Validado no spike da Etapa 0: preflight e POST cross-origin funcionam com
 * `authorization` liberado, e origem não declarada é bloqueada.
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
    tokenRef.current = {
      value: data.token,
      expiresAt: Date.now() + data.expiresIn * 1000,
    };
    return data.token;
  }, []);

  const agent = useEveAgent({
    host: agentHost,
    auth: { bearer },
  });

  const [draft, setDraft] = useState("");
  const busy = agent.status === "submitted" || agent.status === "streaming";

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
