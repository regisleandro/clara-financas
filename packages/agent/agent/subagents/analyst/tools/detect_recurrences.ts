import { detectRecurrences, formatCents } from "@clara-financas/ledger";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadMerchantAliases } from "../../../lib/aliases";
import { requireTenantCaller } from "../../../lib/tenant";
import { loadLedger } from "../../../lib/ledger-query";

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
      .describe(
        "Minimum number of charges to count as a recurrence. Defaults to 2, which surfaces likely patterns from only two invoices; each result carries `confirmed` so you can say which are certain. Raise to 3 to see only confirmed ones.",
      ),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const [ledger, merchantAliases] = await Promise.all([
      loadLedger(tenantId),
      // Apelidos aprovados entram no agrupamento. Sem esta linha o conceito
      // MerchantAlias seria gravável e inerte.
      loadMerchantAliases(tenantId),
    ]);

    // Sem `?? 3`: o default do domínio é 2, e repeti-lo aqui com outro valor
    // era o que mantinha a análise muda para quem tem duas faturas.
    const recurrences = detectRecurrences(
      ledger,
      input.minOccurrences === undefined
        ? { merchantAliases }
        : { minOccurrences: input.minOccurrences, merchantAliases },
    );

    if (recurrences.length === 0) {
      return {
        empty: true as const,
        message:
          "No repeating charge found. A pattern needs at least two charges roughly a month apart, so with a single invoice on file this is expected rather than informative — say so instead of implying the person has no subscriptions.",
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
        // Duas cobranças são indício; três ou mais, padrão estabelecido. Sem
        // este campo o modelo apresentaria as duas com a mesma segurança.
        confirmed: recurrence.confirmed,
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
