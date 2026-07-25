import { aggregateByCategory, formatCents, totalSpend } from "@clara-financas/ledger";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { categoryLabel, loadCategoryLabels } from "../../../lib/categories";
import { requireTenantCaller } from "../../../lib/tenant";
import { optionalText } from "../../../lib/schema";
import { ledgerCoverage, loadLedger } from "../lib/query";

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
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const ledger = await loadLedger(tenantId, { from: input.from, to: input.to });

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
      period: { from: input.from ?? null, to: input.to ?? null },
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
