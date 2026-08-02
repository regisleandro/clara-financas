import Link from "next/link";
import { redirect } from "next/navigation";

import { formatCents } from "@clara-financas/ledger";

import { OverviewFilters } from "@/components/overview-filters";
import { SpendCard } from "@/components/spend-card";
import { loadOverview } from "@/lib/overview";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * A comparação tem uma rota própria para quem prefere explorar a análise por
 * abas, mas continua apontando de volta para a conversa como próximo passo.
 */
export default async function ComparacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; origem?: string }>;
}) {
  const context = await getTenantContext();
  if (!context) redirect("/entrar");

  const query = await searchParams;
  const overview = await loadOverview(context.tenantId, {
    month: query.mes,
    issuer: query.origem,
  });

  return (
    <div className="clara-shell pb-40 pt-10 sm:pt-14">
      <header className="flex flex-wrap items-end justify-between gap-8 border-b border-[var(--clara-border)] pb-10">
        <div>
          <p className="clara-eyebrow mb-4">Comparação</p>
          <h1 className="clara-hero max-w-[12ch]">O que mudou.</h1>
          <p className="clara-lead mt-4 max-w-[42ch]">
            Veja a diferença entre o mês selecionado e o anterior. Se preferir,
            peça para a Clara explicar a causa em uma conversa.
          </p>
        </div>
        <Link href="/conversa" className="clara-pill clara-pill-primary">
          Perguntar à Clara
        </Link>
      </header>

      <div className="pt-8">
        <OverviewFilters
          months={overview.months}
          issuers={overview.issuers}
          selectedMonth={overview.selectedMonth}
          selectedIssuer={overview.selectedIssuer}
        />
      </div>

      {overview.selectedMonth === null ? (
        <section className="clara-note clara-note-yellow mt-8 p-6 sm:p-8">
          <h2 className="clara-display-md">Ainda não há períodos para comparar.</h2>
          <p className="mt-3 max-w-[48ch] text-[var(--clara-graphite)]">
            Envie uma fatura ou extrato pela conversa para construir o primeiro
            recorte de gastos.
          </p>
        </section>
      ) : (
        <>
          <div className="mt-8 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <SpendCard
              periodLabel={overview.periodLabel}
              originLabel={overview.originLabel}
              total={overview.total}
              comparison={overview.comparison}
              spark={overview.spark}
              rangeLabels={overview.rangeLabels}
            />
            <ComparisonSummary overview={overview} />
          </div>

          <section className="pt-14">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="clara-eyebrow mb-2">Onde a variação apareceu</p>
                <h2 className="clara-display-md">Categorias que explicam o mês</h2>
              </div>
              <Link href="/conversa" className="clara-link">
                Explorar com a Clara →
              </Link>
            </div>
            <div className="clara-card overflow-hidden">
              {overview.categories.length === 0 ? (
                <p className="p-8 text-[var(--clara-slate)]">
                  Não há gastos categorizados neste recorte.
                </p>
              ) : (
                <ul>
                  {overview.categories.map((category) => (
                    <li
                      key={category.label}
                      className="grid gap-3 border-b border-[var(--clara-border)] px-5 py-5 last:border-b-0 sm:grid-cols-[minmax(160px,0.8fr)_1fr_auto] sm:items-center sm:px-6"
                    >
                      <span className="font-medium">{category.label}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-[var(--clara-fog)]">
                        <i
                          className="block h-full rounded-full bg-[var(--clara-ink)]"
                          style={{ width: `${Math.round(category.share * 100)}%` }}
                        />
                      </span>
                      <span className="font-mono text-sm tabular-nums text-[var(--clara-graphite)]">
                        {formatCents(category.value)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function ComparisonSummary({
  overview,
}: {
  overview: Awaited<ReturnType<typeof loadOverview>>;
}) {
  if (overview.comparison === null) {
    return (
      <aside className="clara-note clara-note-teal flex min-h-[280px] flex-col justify-between p-6 sm:p-8">
        <p className="clara-eyebrow text-[var(--clara-ink)]">Leitura da Clara</p>
        <div>
          <h2 className="clara-display-md">Preciso de um período anterior.</h2>
          <p className="mt-3 text-[var(--clara-graphite)]">
            Quando houver dois meses no razão, a comparação aparece aqui com a
            diferença e os principais responsáveis.
          </p>
        </div>
      </aside>
    );
  }

  const increased = overview.comparison.delta > 0;
  return (
    <aside className={`clara-note ${increased ? "clara-note-yellow" : "clara-note-teal"} flex min-h-[280px] flex-col justify-between p-6 sm:p-8`}>
      <div className="flex items-center justify-between gap-4">
        <p className="clara-eyebrow text-[var(--clara-ink)]">Leitura da Clara</p>
        <span className="clara-chip bg-white/50">{increased ? "Subiu" : "Caiu"}</span>
      </div>
      <div>
        <p className="clara-metric text-[var(--clara-ink)]">
          {increased ? "+" : "−"}{Math.abs(overview.comparison.deltaPercent).toLocaleString("pt-BR")}%
        </p>
        <p className="mt-2 text-[var(--clara-graphite)]">
          em relação a {overview.comparison.previousLabel} — uma diferença de {formatCents(Math.abs(overview.comparison.delta))}.
        </p>
      </div>
    </aside>
  );
}
