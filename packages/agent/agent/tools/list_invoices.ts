import { getDb } from "@clara-financas/db";
import { batches, documents, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireTenantCaller } from "../lib/tenant";

/**
 * Recuperação explícita para o histórico que não cabe no snapshot de turno.
 * O snapshot mantém o contexto barato; esta tool abre o histórico sob demanda.
 */
export default defineTool({
  description:
    "Lists invoices already sent by this person, newest first. Use when the requested invoice is older than the bounded ledger snapshot or when the person asks for invoice history.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).optional().describe("Defaults to 20."),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    return forTenant(
      tenantId,
      async (tx) =>
        tx
          .select({
            batchId: batches.id,
            documentId: batches.documentId,
            filename: documents.filename,
            issuer: documents.issuer,
            status: batches.status,
            periodStart: batches.periodStart,
            periodEnd: batches.periodEnd,
            dueDate: batches.dueDate,
            declaredTotalCents: batches.declaredTotal,
            checksumResult: batches.checksumResult,
            transactionCount: sql<number>`(
              select count(*)::int from ${transactions}
              where ${transactions.batchId} = ${batches.id}
            )`,
          })
          .from(batches)
          .innerJoin(documents, eq(documents.id, batches.documentId))
          .where(inArray(batches.status, ["proposed", "confirmed"]))
          .orderBy(desc(batches.periodEnd), desc(batches.createdAt))
          .limit(input.limit ?? 20),
      getDb(),
    );
  },
});
