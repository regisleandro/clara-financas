import { detectRecurrences, formatCents } from "@clara-financas/ledger";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireTenantCaller } from "../../../lib/tenant";
import { loadLedger } from "../lib/query";

/**
 * Cobranças recorrentes.
 *
 * O critério é intervalo regular, não valor igual — assinatura que reajustou
 * continua sendo assinatura, e é justamente a mais interessante de apontar.
 * `priceChangePercent` é o que sustenta "subiu 43% e você quase não usa".
 */
export default defineTool({
  description:
    "Finds charges that repeat monthly at the same merchant, with annualised cost and price drift since the first charge. Use for 'assinaturas', 'cobranças repetidas', 'onde posso economizar'.",
  inputSchema: z.object({
    minOccurrences: z
      .number()
      .int()
      .min(2)
      .max(24)
      .optional()
      .describe("Minimum number of charges to count as a recurrence. Defaults to 3."),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const ledger = await loadLedger(tenantId);

    const recurrences = detectRecurrences(ledger, {
      minOccurrences: input.minOccurrences ?? 3,
    });

    if (recurrences.length === 0) {
      return {
        empty: true as const,
        message:
          "No recurring charge identified. This may simply mean there are few months of history — a pattern needs at least three charges to surface.",
      };
    }

    return {
      count: recurrences.length,
      totalAnnualizedCents: recurrences.reduce(
        (sum, recurrence) => sum + recurrence.annualizedCents,
        0,
      ),
      recurrences: recurrences.map((recurrence) => ({
        merchant: recurrence.merchant,
        occurrences: recurrence.occurrences,
        latestCents: recurrence.latestAmount,
        latestFormatted: formatCents(recurrence.latestAmount),
        firstCents: recurrence.firstAmount,
        priceChangePercent:
          recurrence.priceChangeRatio === null
            ? null
            : Math.round(recurrence.priceChangeRatio * 1000) / 10,
        annualizedCents: recurrence.annualizedCents,
        annualizedFormatted: formatCents(recurrence.annualizedCents),
        medianIntervalDays: recurrence.medianIntervalDays,
        transactionIds: recurrence.transactionIds,
      })),
    };
  },
});
