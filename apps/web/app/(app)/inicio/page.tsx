import Link from "next/link";

import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const SUGGESTIONS = [
  "Por que meus gastos subiram?",
  "Onde posso economizar?",
  "Quais assinaturas aumentaram de preço?",
];

function greeting(date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Sao_Paulo",
    }).format(date),
  );
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export default async function InicioPage() {
  const context = await getTenantContext();

  return (
    <>
      <section>
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">
          COMO ESTÁ SEU MÊS
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">{greeting()}.</h1>
        <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
          Seu dinheiro, explicado com clareza.
        </p>
      </section>

      <section className="mt-12 rounded-2xl border border-dashed p-10 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Ainda não há nada por aqui.</h2>
        <p className="mx-auto mt-2 max-w-md leading-relaxed text-muted-foreground">
          Envie sua primeira fatura em PDF pela conversa. A Clara extrai as transações e mostra a
          conferência antes de registrar qualquer coisa.
        </p>
        <Link
          href="/conversa"
          className="mt-8 inline-flex h-12 items-center justify-center rounded-full bg-primary px-7 text-[15px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Enviar uma fatura
        </Link>
      </section>

      <section className="mt-12">
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">
          PRÓXIMOS PASSOS
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((text) => (
            <Link
              key={text}
              href="/conversa"
              className="rounded-full border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {text}
            </Link>
          ))}
        </div>
      </section>

      <p className="mt-16 font-mono text-xs text-muted-foreground">
        espaço {context?.tenantId}
      </p>
    </>
  );
}
