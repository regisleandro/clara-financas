import { comparePeriods, formatCents, totalSpend } from "@clara-financas/ledger";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { categoryLabel, loadCategoryLabels } from "../../../lib/categories";
import { requireTenantCaller } from "../../../lib/tenant";
import { loadLedger } from "../lib/query";

/**
 * Comparação entre dois períodos.
 *
 * `shareOfChange` é o número que sustenta a frase "restaurantes explicam 62%
 * do aumento": contribuição da categoria para a variação, não a variação dela
 * isolada. É a diferença entre explicar e apenas listar.
 */
export default defineTool({
  description:
    "Compara os gastos de dois períodos por categoria e mostra quem explica a variação. Use para 'por que subiu', 'comparado ao mês passado'.",
  inputSchema: z.object({
    currentFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currentTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    previousFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    previousTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);

    const [current, previous] = await Promise.all([
      loadLedger(tenantId, { from: input.currentFrom, to: input.currentTo }),
      loadLedger(tenantId, { from: input.previousFrom, to: input.previousTo }),
    ]);

    if (current.length === 0 && previous.length === 0) {
      return { empty: true as const, message: "Nenhum dos dois períodos tem transações." };
    }

    const { totalDelta, categories } = comparePeriods(current, previous);
    const labels = await loadCategoryLabels(tenantId);

    return {
      currentTotal: {
        cents: totalSpend(current).value,
        formatted: formatCents(totalSpend(current).value),
      },
      previousTotal: {
        cents: totalSpend(previous).value,
        formatted: formatCents(totalSpend(previous).value),
      },
      totalDelta: { cents: totalDelta, formatted: formatCents(totalDelta) },
      categories: categories.map((entry) => ({
        category: entry.category,
        label: categoryLabel(labels, entry.category),
        currentCents: entry.current.value,
        previousCents: entry.previous.value,
        deltaCents: entry.delta,
        deltaFormatted: formatCents(entry.delta),
        deltaPercent:
          entry.deltaRatio === null ? null : Math.round(entry.deltaRatio * 1000) / 10,
        // Quanto esta categoria explica do AUMENTO total.
        explainsPercentOfIncrease: Math.round(entry.shareOfChange * 1000) / 10,
        currentTransactionIds: entry.current.transactionIds,
        previousTransactionIds: entry.previous.transactionIds,
      })),
    };
  },
});
