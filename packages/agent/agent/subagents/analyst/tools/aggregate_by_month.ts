import { aggregateByIssuerMonth, formatCents, formatMonthLabel } from "@clara-financas/ledger";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { optionalText } from "../../../lib/schema";
import { requireTenantCaller } from "../../../lib/tenant";
import { ledgerCoverage, loadIssuersByDocument, loadLedger } from "../../../lib/ledger-query";

/**
 * O gasto mês a mês, e por operadora dentro de cada mês.
 *
 * Faltava — e a falta não parecia falta. `aggregate_by_category` recorta UM
 * período; `compare_periods` compara DOIS. Uma SÉRIE ("mês a mês", "a evolução",
 * "os últimos meses") não tinha tool: a única saída era chamar a agregação uma
 * vez por mês, adivinhando quantos meses existem, e a pergunta terminava sem
 * resposta.
 *
 * A conta é a MESMA da tela cruzada por operadora (`aggregateByIssuerMonth`, em
 * `@clara-financas/ledger`), que até aqui só a web alcançava. É o caso repetido
 * da fila de revisão atrás de `server-only`: a resposta existia na aba ao lado e
 * a conversa dizia que não sabia. Reimplementar a agregação daria dois números
 * para a mesma pergunta — a tela mostrando um, a Clara falando outro.
 *
 * O mês é o da COMPRA, não o do fechamento da fatura: uma fatura que fecha em
 * julho cobre gastos de maio e junho, e jogá-los em julho deixaria maio vazio.
 * Cada célula carrega os `transactionIds` que a compõem, então toda linha do
 * painel nasce com proveniência.
 */
export default defineTool({
  description:
    "Sums spending month by month, and by card issuer within each month. Use for a SERIES — 'mês a mês', 'os últimos meses', 'a evolução do gasto', 'quanto gastei em cada mês'. The month is the month of PURCHASE, not of the invoice closing. Every row carries its transactionIds. For one period use aggregate_by_category; for exactly two use compare_periods.",
  inputSchema: z.object({
    from: optionalText().describe("Start date, YYYY-MM-DD. Omit for the whole ledger."),
    to: optionalText().describe("End date, YYYY-MM-DD, inclusive."),
    issuer: optionalText().describe(
      "Restrict to one card issuer, as the person says it ('Nubank'). Accent- and case-insensitive.",
    ),
    months: z
      .number()
      .int()
      .min(1)
      .max(36)
      .optional()
      .describe("Keep only the most recent N months of the result. Omit for all of them."),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);

    const [ledger, issuers] = await Promise.all([
      loadLedger(tenantId, { from: input.from, to: input.to, issuer: input.issuer }),
      loadIssuersByDocument(tenantId),
    ]);

    if (ledger.length === 0) {
      const coverage = await ledgerCoverage(tenantId);
      return {
        empty: true as const,
        message:
          coverage.count === 0
            ? "The ledger has no confirmed transactions yet."
            : `Não há transações nesse recorte, mas o razão cobre de ${coverage.firstDate} a ${coverage.lastDate} (${coverage.count} transações). Refaça a pergunta nesse intervalo.`,
        ledgerCoverage: coverage,
      };
    }

    const matrix = aggregateByIssuerMonth(
      ledger.map((entry) => ({ ...entry, issuer: issuers.get(entry.sourceDocument) ?? null })),
    );

    // `months` vem do mais recente para o mais antigo. O corte por `months`
    // acontece ANTES da inversão, para "os últimos 6 meses" pegar os 6 mais
    // recentes e ainda assim ser lido do mais antigo para o mais novo — que é
    // como se lê uma série.
    const keep = input.months ?? matrix.months.length;
    const positions = matrix.months.map((_, position) => position).slice(0, keep).reverse();

    return {
      period: {
        from: input.from ?? null,
        to: input.to ?? null,
        issuer: input.issuer ?? null,
      },
      // Uma linha por mês, do mais antigo para o mais recente: a série é a
      // resposta, e uma série fora de ordem não é uma série.
      months: positions.map((position) => {
        const month = matrix.months[position]!;
        const bucket = matrix.monthTotals[position]!;
        return {
          month,
          label: formatMonthLabel(month),
          cents: bucket.value,
          formatted: formatCents(bucket.value),
          count: bucket.count,
          transactionIds: bucket.transactionIds,
          // A composição por operadora DENTRO do mês, para "o que subiu foi o
          // Nubank" ser uma afirmação com números atrás.
          byIssuer: matrix.issuers.flatMap((row) => {
            const cell = row.byMonth[position];
            if (cell === null || cell === undefined) return [];
            return [
              {
                issuer: row.issuer,
                label: row.issuer ?? "Sem operadora",
                cents: cell.value,
                formatted: formatCents(cell.value),
                count: cell.count,
                transactionIds: cell.transactionIds,
              },
            ];
          }),
        };
      }),
      monthsOmitted: Math.max(0, matrix.months.length - positions.length),
      total: {
        cents: matrix.total.value,
        formatted: formatCents(matrix.total.value),
        transactionIds: matrix.total.transactionIds,
      },
      // Pagamento de fatura fica fora da soma por construção (`spendable`): ele
      // quita o ciclo anterior e não é gasto do mês. Dito aqui para a resposta
      // não prometer um total que inclui o que a conta não inclui.
      note: "Spend only: invoice payments are excluded. The month is the month of purchase.",
    };
  },
});
