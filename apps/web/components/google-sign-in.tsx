"use client";

import { useState } from "react";
import { toast } from "sonner";

import { signIn } from "@/lib/auth-client";

export function GoogleSignIn({ label }: { label: string }) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await signIn.social({
        provider: "google",
        // O onboarding decide para onde ir: /conversa se o espaço estiver
        // pronto, /preparando enquanto provisiona.
        callbackURL: "/conversa",
      });
    } catch {
      setPending(false);
      // A porta de entrada do produto: uma falha aqui sem caminho de volta é a
      // pessoa parada na tela de login com um recado que some em segundos.
      toast.error("Não foi possível entrar com o Google.", {
        action: { label: "Tentar de novo", onClick: () => void handleClick() },
      });
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-[var(--clara-radius-pill)] border border-border bg-background px-6 text-[15px] font-medium transition-colors hover:bg-secondary disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <GoogleMark />
      {pending ? "Abrindo o Google…" : label}
    </button>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="size-[18px]">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
