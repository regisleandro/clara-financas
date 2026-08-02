import Link from "next/link";
import { formatCents } from "@clara-financas/ledger";

/**
 * O razão, com filtro e busca.
 *
 * A coluna de confiança é o que diferencia esta tabela de um extrato bancário:
 * ela admite que a leitura pode estar errada. Confiança baixa fica em tinta
 * cheia e alta em cinza — o inverso do instinto, e de propósito: o que precisa
 * de atenção é o duvidoso, não o certo.
 *
 * A proveniência (documento e página) fica na segunda linha de cada item, e
 * não escondida atrás de um clique: é a promessa da tela, e promessa que exige
 * garimpo não é cumprida. Página, busca e categoria são resolvidas no servidor
 * para que a tabela nunca carregue o razão inteiro no navegador.
 */

export type TableRow = {
  id: string;
  merchant: string;
  date: string;
  category: string | null;
  confidence: "alta" | "media" | "baixa";
  amount: number;
  source: string;
  page: number | null;
  isAdjustment: boolean;
};

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );

const CONFIDENCE_LABEL = { alta: "Alta", media: "Média", baixa: "Baixa" } as const;
const CONFIDENCE_COLOR = {
  alta: "var(--clara-slate)",
  media: "var(--clara-graphite)",
  baixa: "var(--clara-ink)",
} as const;

export function TransactionTable({
  rows,
  categories,
  totalCount,
  page,
  pageCount,
  pageSize,
  query,
  category,
}: {
  rows: TableRow[];
  categories: string[];
  totalCount: number;
  page: number;
  pageCount: number;
  pageSize: number;
  query: string;
  category?: string;
}) {
  const filters = ["Todas", ...categories, "Sem categoria"];
  const hrefFor = (nextPage: number, nextQuery = query, nextCategory = category) => {
    const params = new URLSearchParams();
    if (nextPage > 1) params.set("pagina", String(nextPage));
    if (nextQuery.trim() !== "") params.set("busca", nextQuery.trim());
    if (nextCategory !== undefined && nextCategory !== "") {
      params.set("categoria", nextCategory);
    }
    const encoded = params.toString();
    return encoded === "" ? "/transacoes" : `/transacoes?${encoded}`;
  };

  const firstRow = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, totalCount);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-5">
        <div className="flex flex-wrap gap-2">
          {filters.map((label) => {
            const active = label === "Todas" ? category === undefined : category === label;
            return (
              <Link
                key={label}
                href={hrefFor(1, query, label === "Todas" ? undefined : label)}
                aria-current={active ? "page" : undefined}
                className="rounded-[var(--clara-radius-pill)] border border-[var(--clara-border)] px-[15px] py-2 text-xs transition-colors"
                style={{
                  letterSpacing: "-0.022em",
                  background: active ? "var(--clara-ink)" : "var(--clara-white)",
                  color: active ? "var(--clara-white)" : "var(--clara-ink)",
                }}
              >
                {label}
              </Link>
            );
          })}
        </div>
        <form action="/transacoes" method="get" className="flex w-full sm:w-[280px]">
          <label className="w-full">
            <span className="sr-only">Buscar transação</span>
            <input
              name="busca"
              defaultValue={query}
              placeholder="Buscar transação"
              className="w-full rounded-[var(--clara-radius-pill)] border border-[var(--clara-border)] bg-[var(--clara-white)] px-5 py-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--clara-blue)]"
            />
          </label>
          {category !== undefined ? <input type="hidden" name="categoria" value={category} /> : null}
        </form>
      </div>

      <div className="clara-card px-7 pb-7 pt-3.5">
        <div className="clara-small hidden grid-cols-[44px_1fr_150px_100px_120px] gap-4 py-4 sm:grid">
          <span />
          <span>Descrição</span>
          <span>Categoria</span>
          <span>Confiança</span>
          <span className="text-right">Valor</span>
        </div>

        {rows.length === 0 ? (
          <p className="p-[52px] text-center text-[var(--clara-slate)]">
            {totalCount === 0
              ? query !== "" || category !== undefined
                ? "Nada por aqui com esse filtro."
                : "O razão ainda está vazio. Envie uma fatura pela conversa."
              : "Não há lançamentos nesta página."}
          </p>
        ) : (
          <ul>
            {rows.map((row) => (
              <li
                key={row.id}
                className="grid grid-cols-[44px_1fr_auto] items-center gap-4 border-t border-[var(--clara-fog)] py-4 sm:grid-cols-[44px_1fr_150px_100px_120px]"
              >
                <span
                  aria-hidden="true"
                  className="grid size-9 place-items-center rounded-[var(--clara-radius-tile)] bg-[var(--clara-fog)] text-xs font-semibold"
                >
                  {row.merchant.charAt(0).toUpperCase()}
                </span>

                <span className="min-w-0">
                  <strong className="block truncate font-semibold">{row.merchant}</strong>
                  <small className="clara-small mt-[3px] block">
                    {shortDate(row.date)} · {row.source}
                    {row.page !== null ? ` · página ${row.page}` : ""}
                    {row.isAdjustment ? " · ajuste" : ""}
                  </small>
                </span>

                <span className="hidden sm:block">
                  <i className="clara-chip not-italic">{row.category ?? "sem categoria"}</i>
                </span>

                <span
                  className="hidden text-xs sm:block"
                  style={{ letterSpacing: "-0.022em", color: CONFIDENCE_COLOR[row.confidence] }}
                >
                  {CONFIDENCE_LABEL[row.confidence]}
                </span>

                <span className="text-right tabular-nums">{formatCents(row.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <p className="clara-small">
          {firstRow}–{lastRow} de {totalCount} {totalCount === 1 ? "lançamento" : "lançamentos"}
        </p>
        {pageCount > 1 ? (
          <nav aria-label="Paginação das transações" className="flex items-center gap-2">
            {page > 1 ? (
              <Link href={hrefFor(page - 1)} className="clara-pill clara-pill-outline min-h-9 px-3 text-xs">
                Anterior
              </Link>
            ) : (
              <span aria-disabled="true" className="clara-pill min-h-9 border border-[var(--clara-border)] px-3 text-xs text-[var(--clara-slate)] opacity-50">
                Anterior
              </span>
            )}
            <span className="clara-small px-1">Página {page} de {pageCount}</span>
            {page < pageCount ? (
              <Link href={hrefFor(page + 1)} className="clara-pill clara-pill-outline min-h-9 px-3 text-xs">
                Próxima
              </Link>
            ) : (
              <span aria-disabled="true" className="clara-pill min-h-9 border border-[var(--clara-border)] px-3 text-xs text-[var(--clara-slate)] opacity-50">
                Próxima
              </span>
            )}
          </nav>
        ) : null}
      </div>
    </>
  );
}
