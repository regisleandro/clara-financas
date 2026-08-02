import Link from "next/link";
import { redirect } from "next/navigation";

import { IssuerMonthView } from "@/components/issuer-month-view";
import { TransactionTable } from "@/components/transaction-table";
import { loadIssuerMonthView } from "@/lib/issuers";
import { loadLedgerPage, TRANSACTION_PAGE_SIZE } from "@/lib/ledger";
import { countPendingReview } from "@/lib/review";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Duas vistas do mesmo razão, escolhidas pela URL.
 *
 * `?vista=operadoras` em vez de estado de componente por dois motivos: a
 * escolha vira link compartilhável e recarregável, e nenhuma das duas vistas
 * precisa de JavaScript para existir. O corpo de cada uma é renderizado no
 * servidor; a lista plana usa paginação e filtros via URL para não carregar
 * todos os lançamentos no navegador.
 */

const VIEWS = [
  { key: "lista", label: "Lista", href: "/transacoes" },
  { key: "operadoras", label: "Por operadora e mês", href: "/transacoes?vista=operadoras" },
] as const;

export default async function TransacoesPage({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: string;
    pagina?: string;
    busca?: string;
    categoria?: string;
  }>;
}) {
  const context = await getTenantContext();
  if (!context) redirect("/entrar");

  const { vista, pagina, busca, categoria } = await searchParams;
  const active = vista === "operadoras" ? "operadoras" : "lista";

  const pending = await countPendingReview(context.tenantId);

  return (
    <div className="clara-shell pb-40 pt-12">
      <header className="flex flex-wrap items-end justify-between gap-10 py-16 sm:py-24">
        <div>
          <p className="clara-eyebrow mb-5">Seu razão</p>
          <h1 className="clara-hero">Transações.</h1>
          <p className="clara-lead mt-3 max-w-[32ch]">
            Cada número pode ser rastreado até a origem.
          </p>
        </div>
        <Link href="/conversa" className="clara-pill clara-pill-primary mb-2.5">
          Importar fatura
        </Link>
      </header>

      {pending > 0 ? (
        <Link
          href="/revisar"
          className="clara-card mb-6 flex items-center justify-between gap-5 px-7 py-5 transition-opacity hover:opacity-80"
        >
          <span>
            <strong className="block font-semibold">
              {pending} {pending === 1 ? "lançamento precisa" : "lançamentos precisam"} da sua
              revisão
            </strong>
            <small className="clara-small mt-[3px] block">
              Sem categoria, leitura duvidosa ou comerciante não identificado.
            </small>
          </span>
          <span aria-hidden="true" className="text-[var(--clara-slate)]">
            ›
          </span>
        </Link>
      ) : null}

      <nav aria-label="Vista do razão" className="mb-6 flex flex-wrap gap-2">
        {VIEWS.map((view) => (
          <Link
            key={view.key}
            href={view.href}
            aria-current={active === view.key ? "page" : undefined}
            className="rounded-[var(--clara-radius-pill)] border border-[var(--clara-border)] px-[15px] py-2 text-xs transition-colors"
            style={{
              letterSpacing: "-0.022em",
              background: active === view.key ? "var(--clara-ink)" : "var(--clara-white)",
              color: active === view.key ? "var(--clara-white)" : "var(--clara-ink)",
            }}
          >
            {view.label}
          </Link>
        ))}
      </nav>

      {active === "operadoras" ? (
        <IssuerMonthView view={await loadIssuerMonthView(context.tenantId)} />
      ) : (
        <FlatList
          tenantId={context.tenantId}
          page={parsePage(pagina)}
          query={busca}
          category={categoria}
        />
      )}
    </div>
  );
}

function parsePage(value: string | undefined) {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

async function FlatList({
  tenantId,
  page,
  query,
  category,
}: {
  tenantId: string;
  page: number;
  query?: string;
  category?: string;
}) {
  const result = await loadLedgerPage(tenantId, {
    page,
    pageSize: TRANSACTION_PAGE_SIZE,
    query,
    category,
  });

  return (
    <TransactionTable
      rows={result.rows.map((row) => ({
        id: row.id,
        merchant: row.merchant ?? row.originalDescription,
        date: row.date,
        category: row.category,
        confidence: row.extractionConfidence,
        amount: row.amount,
        source: row.documentIssuer ?? row.documentFilename ?? "documento",
        page: row.page,
        isAdjustment: row.status === "adjustment",
      }))}
      categories={result.categories}
      totalCount={result.total}
      page={result.page}
      pageCount={result.pageCount}
      pageSize={result.pageSize}
      query={result.query}
      category={result.category}
    />
  );
}
