import { getDb } from "@clara-financas/db";
import { commitments } from "@clara-financas/db/schema/commitment";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { formatCents } from "@clara-financas/ledger";
import { and, asc, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireTenantCaller } from "../lib/tenant";
import { daysUntil, todayInSaoPaulo } from "../lib/dates";

/**
 * Compromissos ativos, do mais próximo ao mais distante.
 *
 * Leitura pura, sem gate. É o que o schedule consulta quando acorda e o que a
 * Clara usa para responder "o que vence".
 */
export default defineTool({
  description:
    "Lists active due dates and reminders, with how many days remain. Use to answer what is coming due.",
  inputSchema: z.object({
    withinDays: z
      .number()
      .int()
      .min(0)
      .max(365)
      .optional()
      .describe("Only those due within this many days. Omit for all of them."),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const today = todayInSaoPaulo();

    const rows = await forTenant(
      tenantId,
      async (tx) =>
        tx
          .select()
          .from(commitments)
          .where(and(eq(commitments.tenantId, tenantId), eq(commitments.active, "yes")))
          .orderBy(asc(commitments.dueDate)),
      getDb(),
    );

    const enriched = rows
      .map((row) => ({
        id: row.id,
        title: row.title,
        counterparty: row.counterparty,
        kind: row.kind,
        dueDate: row.dueDate,
        daysUntil: daysUntil(today, row.dueDate),
        expectedAmount: row.expectedAmount,
        expectedFormatted:
          row.expectedAmount === null ? null : formatCents(row.expectedAmount),
        remindDaysBefore: row.remindDaysBefore,
      }))
      .filter((row) =>
        input.withinDays === undefined ? true : row.daysUntil <= input.withinDays,
      );

    return { today, count: enriched.length, commitments: enriched };
  },
});
