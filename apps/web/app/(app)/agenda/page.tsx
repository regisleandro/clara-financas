import Link from "next/link";
import { redirect } from "next/navigation";

import { loadAgenda } from "@/lib/agenda";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

const dayOf = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );
const monthOf = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" })
    .format(new Date(`${iso}T12:00:00Z`))
    .replace(".", "");
const longDay = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );

function whenLabel(days: number): string {
  if (days < 0) return `Venceu há ${Math.abs(days)} ${Math.abs(days) === 1 ? "dia" : "dias"}`;
  if (days === 0) return "Vence hoje";
  if (days === 1) return "Amanhã";
  return `Em ${days} dias`;
}

export default async function AgendaPage() {
  const context = await getTenantContext();
  if (!context) redirect("/entrar");

  const { commitments, notifications } = await loadAgenda(context.tenantId);
  const [next, ...rest] = commitments;

  return (
    <div className="clara-shell pb-40 pt-12">
      <header className="flex flex-wrap items-end justify-between gap-10 py-16 sm:py-24">
        <div>
          <p className="clara-eyebrow mb-5">Proatividade</p>
          <h1 className="clara-hero">Agenda.</h1>
          <p className="clara-lead mt-3 max-w-[34ch]">
            A Clara cuida dos prazos antes que eles virem preocupação.
          </p>
        </div>
        <Link href="/conversa" className="clara-pill clara-pill-primary mb-2.5">
          Novo lembrete
        </Link>
      </header>

      {/* O gatilho invertido: estas mensagens não responderam a nada. A Clara
          acordou sozinha e deixou dito. */}
      {notifications.length > 0 ? (
        <section className="mb-10">
          <p className="clara-eyebrow mb-4">A Clara te avisou</p>
          <ul className="space-y-3">
            {notifications.map((notification) => (
              <li key={notification.id} className="clara-card p-6">
                <p className="clara-display-xs">{notification.title}</p>
                <p className="mt-1.5 text-[var(--clara-graphite)]">{notification.body}</p>
                <p className="clara-small mt-3 font-mono">{notification.createdBy}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[1.35fr_1fr]">
        {next === undefined ? (
          <article className="clara-card p-7">
            <span className="clara-chip">Nada agendado</span>
            <h2 className="clara-display-md mt-8">Sem compromissos ainda.</h2>
            <p className="mt-2 text-[var(--clara-graphite)]">
              Quando você registrar uma fatura, a Clara propõe lembrar do vencimento. Ela só
              avisa o que você aprovar.
            </p>
          </article>
        ) : (
          <article className="clara-card p-7">
            <span className="clara-chip">{whenLabel(next.daysUntil)}</span>
            <h2 className="clara-display-md mt-8">{next.title}</h2>
            <p className="mt-2 text-[var(--clara-graphite)]">
              Vencimento em {longDay(next.dueDate)}
            </p>
            {next.expectedAmount !== null ? (
              <p className="clara-metric mt-6">{brl(next.expectedAmount)}</p>
            ) : null}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/conversa" className="clara-pill clara-pill-outline">
                Falar com a Clara
              </Link>
              <Link href="/transacoes" className="clara-link">
                Conferir os lançamentos ›
              </Link>
            </div>
          </article>
        )}

        <article className="clara-card p-7">
          <h3 className="clara-display-sm mb-2">Próximos compromissos</h3>
          {rest.length === 0 ? (
            <p className="py-6 text-[var(--clara-slate)]">Nenhum outro compromisso.</p>
          ) : (
            <ul>
              {rest.map((commitment) => (
                <li
                  key={commitment.id}
                  className="grid grid-cols-[52px_1fr_auto] items-center gap-4 border-t border-[var(--clara-fog)] py-[18px]"
                >
                  <span className="text-center">
                    <strong
                      className="block text-[21px] font-semibold"
                      style={{ fontFamily: "var(--clara-display)", letterSpacing: "-0.012em" }}
                    >
                      {dayOf(commitment.dueDate)}
                    </strong>
                    <small className="clara-eyebrow block">{monthOf(commitment.dueDate)}</small>
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate font-semibold">{commitment.title}</strong>
                    <small className="clara-small mt-[3px] block">
                      {whenLabel(commitment.daysUntil)}
                      {commitment.counterparty !== null ? ` · ${commitment.counterparty}` : ""}
                    </small>
                  </span>
                  <span className="tabular-nums">
                    {commitment.expectedAmount === null
                      ? "—"
                      : brl(commitment.expectedAmount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </div>
  );
}
