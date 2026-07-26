import { aggregateByCategory, formatCents, totalSpend } from "@clara-financas/ledger";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { categoryLabel, loadCategoryLabels } from "../../../lib/categories";
import { monthRange } from "../../../lib/dates";
import { requireTenantCaller } from "../../../lib/tenant";
import { optionalText } from "../../../lib/schema";
import { ledgerCoverage, loadLedger } from "../../../lib/ledger-query";

/**
 * Composição do gasto por categoria.
 *
 * Devolve `transactionIds` em cada linha — é isso que faz a proveniência ser
 * estrutural, e não uma citação que o modelo pode esquecer de fazer.
 */
export default defineTool({
  description:
    "Sums spending by category over a period. Use for 'quanto gastei', 'com o quê', 'qual categoria pesa mais'.",
  inputSchema: z.object({
    from: optionalText().describe("Start date, YYYY-MM-DD. Omit for the whole ledger."),
    to: optionalText().describe("End date, YYYY-MM-DD, inclusive."),
    month: optionalText().describe(
      "Calendar month, YYYY-MM. Shorthand for from/to covering the whole month. Remember an invoice CYCLE is not a calendar month — for 'nesta fatura' questions prefer batchId.",
    ),
    issuer: optionalText().describe(
      "Card issuer/operator name as the person says it (e.g. 'Nubank'). Accent- and case-insensitive; matches the issuer of the document each transaction came from. Use for 'quanto gastei no <cartão>'.",
    ),
    batchId: optionalText().describe(
      "Restrict to ONE invoice, by the batchId shown in the ledger state. Prefer this over guessing dates whenever the question is about a specific invoice or 'nesta fatura'.",
    ),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const monthDates = input.month !== undefined ? monthRange(input.month) : undefined;
    const ledger = await loadLedger(tenantId, {
      from: input.from ?? monthDates?.from,
      to: input.to ?? monthDates?.to,
      issuer: input.issuer,
      batchId: input.batchId,
    });

    if (ledger.length === 0) {
      // Vazio sem contexto é ambíguo: razão vazio, ou recorte errado? Dizer o
      // que existe evita mandar a pessoa reenviar o que já está registrado.
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

    const total = totalSpend(ledger);
    const categories = aggregateByCategory(ledger);
    const uncategorized = categories.find((bucket) => bucket.category === null);
    const labels = await loadCategoryLabels(tenantId);

    return {
      // O recorte de FATO usado, para a resposta dizer em relação a quê soma.
      period: {
        from: input.from ?? monthDates?.from ?? null,
        to: input.to ?? monthDates?.to ?? null,
        batchId: input.batchId ?? null,
        issuer: input.issuer ?? null,
      },
      total: {
        cents: total.value,
        formatted: formatCents(total.value),
        transactionIds: total.transactionIds,
      },
      categories: categories.map((bucket) => ({
        category: bucket.category,
        // O rótulo acompanha o id: é o que o modelo deve escrever na resposta
        // e o que o painel deve exibir. O id fica para proveniência e regra.
        label: categoryLabel(labels, bucket.category),
        cents: bucket.value,
        formatted: formatCents(bucket.value),
        sharePercent: Math.round(bucket.share * 1000) / 10,
        count: bucket.count,
        transactionIds: bucket.transactionIds,
      })),
      // Explicitado para o modelo poder avisar que a leitura está incompleta.
      uncategorizedCount: uncategorized?.count ?? 0,
    };
  },
});
