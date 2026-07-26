import type { IssuerMonthView } from "@/lib/issuers";
import { formatCents } from "@clara-financas/ledger";

/**
 * O razão cruzado: operadora nas linhas, mês nas colunas.
 *
 * Duas leituras na mesma tela, e a ordem entre elas é deliberada. Primeiro a
 * matriz, que responde "quanto, em qual cartão, em qual mês" de um olhar.
 * Depois os grupos, que respondem "quais gastos são esses" — fechados por
 * padrão, porque abrir tudo devolveria a lista plana que a pessoa acabou de
 * sair.
 *
 * Célula vazia é `—`, não `R$ 0,00`. A distinção é real: um mês sem fatura
 * daquela operadora não é um mês em que ela não cobrou nada.
 *
 * É um `<table>` de verdade e um `<details>` nativo — dado tabular tem
 * semântica própria, e o colapso não precisa de JavaScript para funcionar.
 */

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

export function IssuerMonthView({ view }: { view: IssuerMonthView }) {
  if (view.issuers.length === 0) {
    return (
      <div className="clara-card p-[52px] text-center text-[var(--clara-slate)]">
        O razão ainda está vazio. Envie uma fatura pela conversa.
      </div>
    );
  }

  return (
    <>
      <div className="clara-card overflow-x-auto p-7">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <caption className="sr-only">
            Gasto confirmado por operadora e por mês da compra
          </caption>
          <thead>
            <tr className="clara-small">
              <th scope="col" className="pb-4 pr-6 font-normal">
                Operadora
              </th>
              {view.months.map((month) => (
                <th key={month.key} scope="col" className="pb-4 pl-6 text-right font-normal">
                  {month.label}
                </th>
              ))}
              <th scope="col" className="pb-4 pl-6 text-right font-normal">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {view.issuers.map((issuer) => (
              <tr key={issuer.key} className="border-t border-[var(--clara-fog)]">
                <th scope="row" className="py-[18px] pr-6 font-semibold">
                  {issuer.label}
                  <small className="clara-small ml-2 font-normal">
                    {issuer.count} {issuer.count === 1 ? "lançamento" : "lançamentos"}
                  </small>
                </th>
                {issuer.byMonth.map((cell, position) => (
                  <td
                    key={view.months[position]!.key}
                    className="py-[18px] pl-6 text-right tabular-nums"
                    style={cell === null ? { color: "var(--clara-slate)" } : undefined}
                  >
                    {cell === null ? "—" : formatCents(cell.value)}
                  </td>
                ))}
                <td className="py-[18px] pl-6 text-right font-semibold tabular-nums">
                  {formatCents(issuer.total)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--clara-ink)]">
              <th scope="row" className="pt-[18px] pr-6 font-semibold">
                Total do mês
              </th>
              {view.monthTotals.map((total, position) => (
                <td
                  key={view.months[position]!.key}
                  className="pt-[18px] pl-6 text-right font-semibold tabular-nums"
                >
                  {formatCents(total)}
                </td>
              ))}
              <td className="pt-[18px] pl-6 text-right font-semibold tabular-nums">
                {formatCents(view.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <section className="pt-16 sm:pt-24">
        <h2 className="clara-display-md mb-10">De onde vem cada número.</h2>

        <div className="grid gap-3">
          {view.groups.map((group, position) => (
            <details
              key={group.key}
              open={position === 0}
              className="clara-card overflow-hidden px-7 py-1"
            >
              <summary className="flex cursor-pointer list-none items-center gap-4 py-5">
                <span className="min-w-0 flex-1">
                  <strong className="block truncate font-semibold">{group.issuerLabel}</strong>
                  <small className="clara-small mt-[3px] block">
                    {group.monthLabel} · {group.rows.length}{" "}
                    {group.rows.length === 1 ? "lançamento" : "lançamentos"}
                  </small>
                </span>
                <span className="tabular-nums">{formatCents(group.total)}</span>
                <span aria-hidden="true" className="text-[var(--clara-slate)]">
                  ›
                </span>
              </summary>

              <ul className="pb-4">
                {group.rows.map((row) => (
                  <li
                    key={row.id}
                    className="grid grid-cols-[1fr_auto] items-center gap-4 border-t border-[var(--clara-fog)] py-4 sm:grid-cols-[1fr_150px_100px_120px]"
                  >
                    <span className="min-w-0">
                      <strong className="block truncate font-normal">{row.merchant}</strong>
                      <small className="clara-small mt-[3px] block">
                        {shortDate(row.date)}
                        {row.filename === null ? "" : ` · ${row.filename}`}
                        {row.page === null ? "" : ` · página ${row.page}`}
                        {row.isAdjustment ? " · ajuste" : ""}
                      </small>
                    </span>

                    <span className="hidden sm:block">
                      <i className="clara-chip not-italic">{row.categoryLabel}</i>
                    </span>

                    <span
                      className="hidden text-xs sm:block"
                      style={{
                        letterSpacing: "-0.022em",
                        color: CONFIDENCE_COLOR[row.confidence],
                      }}
                    >
                      {CONFIDENCE_LABEL[row.confidence]}
                    </span>

                    <span className="text-right tabular-nums">{formatCents(row.amount)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
