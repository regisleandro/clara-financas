import { redirect } from "next/navigation";

import { loadAgenda } from "@/lib/agenda";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

function whenLabel(days: number): string {
  if (days < 0) return `venceu há ${Math.abs(days)} ${Math.abs(days) === 1 ? "dia" : "dias"}`;
  if (days === 0) return "vence hoje";
  if (days === 1) return "vence amanhã";
  return `vence em ${days} dias`;
}

export default async function AgendaPage() {
  const context = await getTenantContext();
  if (!context) redirect("/entrar");

  const { commitments, notifications } = await loadAgenda(context.tenantId);

  return (
    <>
      <section>
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">
          PROATIVIDADE
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Agenda.</h1>
        <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
          A Clara cuida dos prazos antes que eles virem preocupação.
        </p>
      </section>

      {/* O gatilho invertido (H6): estas mensagens não foram respostas a nada.
          A Clara acordou sozinha, decidiu que havia algo a dizer e deixou
          dito. */}
      {notifications.length > 0 ? (
        <section className="mt-10">
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">
            A CLARA TE AVISOU
          </p>
          <ul className="mt-4 space-y-3">
            {notifications.map((notification) => (
              <li
                key={notification.id}
                className="rounded-2xl border bg-[var(--clara-amber-bg)] p-5"
              >
                <p className="font-medium text-[var(--clara-amber)]">{notification.title}</p>
                <p className="mt-1 leading-relaxed text-[var(--clara-amber)]/80">
                  {notification.body}
                </p>
                <p className="mt-3 font-mono text-xs text-[var(--clara-amber)]/70">
                  {notification.createdBy}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-12">
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">
          PRÓXIMOS COMPROMISSOS
        </p>

        {commitments.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed p-10 text-center">
            <h2 className="text-xl font-semibold tracking-tight">Nada agendado ainda.</h2>
            <p className="mx-auto mt-2 max-w-md leading-relaxed text-muted-foreground">
              Quando você registrar uma fatura, a Clara vai propor lembrar do vencimento. Ela só
              avisa o que você aprovar.
            </p>
          </div>
        ) : (
          <ul className="mt-4 divide-y">
            {commitments.map((commitment) => (
              <li key={commitment.id} className="flex flex-wrap items-baseline gap-x-4 py-4">
                <span className="w-28 shrink-0 text-muted-foreground">
                  {dateFormat.format(new Date(`${commitment.dueDate}T12:00:00Z`))}
                </span>
                <span className="font-medium">{commitment.title}</span>
                <span
                  className={
                    commitment.daysUntil <= 3
                      ? "text-sm text-[var(--clara-amber)]"
                      : "text-sm text-muted-foreground"
                  }
                >
                  {whenLabel(commitment.daysUntil)}
                </span>
                {commitment.expectedAmount !== null ? (
                  <span className="ml-auto tabular-nums">
                    {brl(commitment.expectedAmount)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
