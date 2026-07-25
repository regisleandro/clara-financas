"use client";

import { useMemo, useState } from "react";

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
 * garimpo não é cumprida.
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

const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

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
}: {
  rows: TableRow[];
  categories: string[];
}) {
  const [filter, setFilter] = useState<string>("Todas");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesFilter =
        filter === "Todas" ||
        (filter === "Sem categoria" ? row.category === null : row.category === filter);
      const matchesQuery = needle === "" || row.merchant.toLowerCase().includes(needle);
      return matchesFilter && matchesQuery;
    });
  }, [rows, filter, query]);

  const filters = ["Todas", ...categories, "Sem categoria"];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-5">
        <div className="flex flex-wrap gap-2">
          {filters.map((label) => {
            const active = filter === label;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setFilter(label)}
                aria-pressed={active}
                className="rounded-full px-[15px] py-2 text-xs transition-colors"
                style={{
                  letterSpacing: "-0.022em",
                  background: active ? "var(--clara-ink)" : "var(--clara-white)",
                  color: active ? "var(--clara-white)" : "var(--clara-ink)",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <label className="w-full sm:w-[280px]">
          <span className="sr-only">Buscar transação</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar transação"
            className="w-full rounded-[var(--clara-radius-pill)] bg-white px-5 py-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--clara-blue)]"
          />
        </label>
      </div>

      <div className="clara-card px-7 pb-7 pt-3.5">
        <div className="clara-small hidden grid-cols-[44px_1fr_150px_100px_120px] gap-4 py-4 sm:grid">
          <span />
          <span>Descrição</span>
          <span>Categoria</span>
          <span>Confiança</span>
          <span className="text-right">Valor</span>
        </div>

        {filtered.length === 0 ? (
          <p className="p-[52px] text-center text-[var(--clara-slate)]">
            {rows.length === 0
              ? "O razão ainda está vazio. Envie uma fatura pela conversa."
              : "Nada por aqui com esse filtro."}
          </p>
        ) : (
          <ul>
            {filtered.map((row) => (
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

                <span className="text-right tabular-nums">{brl(row.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="clara-small mt-6">
        {filtered.length} {filtered.length === 1 ? "lançamento" : "lançamentos"} · nenhuma
        categoria alterada sem sua aprovação.
      </p>
    </>
  );
}
