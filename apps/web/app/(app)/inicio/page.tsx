import Link from "next/link";
import { redirect } from "next/navigation";

import { env } from "@clara-financas/env/web";
import { formatCents } from "@clara-financas/ledger";

import { OverviewFilters } from "@/components/overview-filters";
import { SpendCard } from "@/components/spend-card";
import { loadOverview } from "@/lib/overview";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Sao_Paulo",
    }).format(new Date()),
  );
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

const longDate = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

export default async function InicioPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; origem?: string }>;
}) {
  const context = await getTenantContext();
  if (!context) redirect("/entrar");

  const query = await searchParams;
  const agentHost = context.agentHost ?? env.NEXT_PUBLIC_AGENT_HOST;
  const overview = await loadOverview(agentHost, context.tenantId, context.userId, {
    month: query.mes,
    issuer: query.origem,
  });
  const firstName = context.name?.split(" ")[0] ?? "";

  return (
    <div className="clara-shell pb-40 pt-12">
      <header className="flex flex-wrap items-end justify-between gap-10 py-16 sm:py-24">
        <div>
          <p className="clara-eyebrow mb-5">{longDate.format(new Date())}</p>
          <h1 className="clara-hero">
            {greeting()}
            {firstName === "" ? "." : `, ${firstName}.`}
          </h1>
          <p className="clara-lead mt-3">Seu dinheiro, explicado com clareza.</p>
        </div>
        <div className="flex items-center gap-5 pb-2.5">
          <Link href="/transacoes" className="clara-link">
            Ver o razão ›
          </Link>
          <Link href="/conversa" className="clara-pill clara-pill-primary">
            Conversar com a Clara
          </Link>
        </div>
      </header>

      <OverviewFilters
        months={overview.months}
        issuers={overview.issuers}
        selectedMonth={overview.selectedMonth}
        selectedIssuer={overview.selectedIssuer}
      />

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <SpendCard
          periodLabel={overview.periodLabel}
          originLabel={overview.originLabel}
          total={overview.total}
          comparison={overview.comparison}
          spark={overview.spark}
          rangeLabels={overview.rangeLabels}
        />
        <InsightCard insight={overview.insight} />
      </div>

      <section className="pt-16 sm:pt-24">
        <div className="mb-10 flex items-baseline justify-between gap-6">
          <h2 className="clara-display-md">Para onde foi.</h2>
          <Link href="/transacoes" className="clara-link">
            Todas as transações ›
          </Link>
        </div>

        <div className="clara-card p-7">
          {overview.categories.length === 0 ? (
            <p className="py-10 text-center text-[var(--clara-slate)]">
              Não há gastos categorizados neste recorte.
            </p>
          ) : (
            <ul>
              {overview.categories.map((category) => (
                <li
                  key={category.label}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-[var(--clara-fog)] py-[18px] first:border-t-0 sm:grid-cols-[200px_1fr_110px_70px] sm:gap-5"
                >
                  <span>{category.label}</span>
                  <span className="col-span-2 order-last block h-1.5 overflow-hidden rounded-full bg-[var(--clara-fog)] sm:order-none sm:col-span-1">
                    <i
                      className="block h-1.5 rounded-full bg-[var(--clara-ink)]"
                      style={{ width: `${Math.round(category.share * 100)}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums">{formatCents(category.value)}</span>
                  <span className="clara-small hidden text-right sm:block">
                    {category.countLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

/** O insight é uma nota curta, com cor para orientar sem competir com os dados. */
function InsightCard({ insight }: { insight: { headline: string; href: string } | null }) {
  if (insight === null) {
    return (
      <article className="clara-card flex min-h-[360px] flex-col justify-between p-7">
        <span className="clara-chip self-start">O que a Clara notou</span>
        <div>
          <p className="clara-display-md text-balance">
            Assim que houver dois períodos no razão, eu explico o que mudou.
          </p>
          <Link href="/conversa" className="clara-link mt-5 inline-block">
            Enviar uma fatura ›
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article className="clara-note clara-note-yellow flex min-h-[360px] flex-col justify-between p-7">
      <span className="clara-chip self-start bg-white/50">O que a Clara notou</span>
      <div>
        <p className="clara-display-md text-balance text-[var(--clara-ink)]">
          {insight.headline}
        </p>
        <Link href={insight.href} className="clara-link mt-5 inline-block">
          Perguntar à Clara →
        </Link>
      </div>
    </article>
  );
}
