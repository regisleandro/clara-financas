import { getDb } from "@clara-financas/db";
import { transactionReclassifications } from "@clara-financas/db/schema/reclassification";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { optionalText } from "../lib/schema";
import { requireTenantCaller } from "../lib/tenant";

/**
 * A trilha de reclassificação ganha leitor.
 *
 * `transaction_reclassifications` era escrita por três tools e lida por zero:
 * "o que você mudou e quando?" não tinha porta, e desfazer uma regra aplicada
 * em lote era desfazer pela metade — a regra saía do conhecimento, mas ninguém
 * sabia mais quais linhas ela havia tocado. Esta tool responde os dois casos:
 * a trilha de UMA transação, e o alcance de UM conceito (`byConceptId`).
 *
 * Leitura pura, sem gate. A trilha é append-only por grant de banco; o que
 * sai daqui é exatamente o que foi gravado, na ordem inversa da gravação.
 */
const LIMIT = 100;

export default defineTool({
  description:
    "Reads the reclassification trail: what changed category or merchant, when, by whom and why. Filter by transactionId for one entry's history, or by byConceptId to see every line a learned rule touched — that is how you undo a rule application entirely. Newest first.",
  inputSchema: z.object({
    transactionId: optionalText().describe("Trail of ONE entry."),
    byConceptId: optionalText().describe(
      "Every change motivated by this concept (e.g. a learned rule) — the scope you need to undo it.",
    ),
    limit: z.number().int().min(1).max(LIMIT).optional(),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const limit = input.limit ?? 20;

    const filters: SQL[] = [eq(transactionReclassifications.tenantId, tenantId)];
    if (input.transactionId !== undefined) {
      filters.push(eq(transactionReclassifications.transactionId, input.transactionId));
    }
    if (input.byConceptId !== undefined) {
      filters.push(eq(transactionReclassifications.byConceptId, input.byConceptId));
    }

    const rows = await forTenant(
      tenantId,
      async (tx) =>
        tx
          .select()
          .from(transactionReclassifications)
          .where(and(...filters))
          .orderBy(desc(transactionReclassifications.createdAt))
          .limit(limit + 1),
      getDb(),
    );

    const truncated = rows.length > limit;
    const page = truncated ? rows.slice(0, limit) : rows;

    return {
      count: page.length,
      ...(truncated
        ? {
            truncated: true as const,
            note: `Mostrando as ${limit} mudanças mais recentes; há mais. Filtre por transactionId ou byConceptId, ou aumente o limit.`,
          }
        : {}),
      changes: page.map((row) => ({
        transactionId: row.transactionId,
        field: row.field,
        previousValue: row.previousValue,
        newValue: row.newValue,
        author: row.author,
        reason: row.reason,
        byConceptId: row.byConceptId,
        changedAt: row.createdAt.toISOString(),
      })),
      undo: "Para desfazer: recategorize_transactions (ou set_transaction_category) de volta ao previousValue — a trilha é append-only, o desfazer também fica registrado.",
    };
  },
});
