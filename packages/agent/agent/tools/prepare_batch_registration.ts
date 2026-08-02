import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { financialActionProposals } from "@clara-financas/db/schema/financial-action";
import { batches, documents, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import {
  formatCents,
  formatDocumentLabel,
  type ChecksumReport,
  type StatementBalanceReport,
} from "@clara-financas/ledger";
import { and, count, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { notFound, refused } from "../lib/errors";
import { requireTenantCaller } from "../lib/tenant";

export default defineTool({
  description:
    "Prepares the canonical registration proposal for one draft financial document. Call immediately before commit_batch, then pass the returned proposalId to commit_batch. This freezes the document revision, verification and number of entries shown in the approval.",
  inputSchema: z.object({ batchId: z.string().min(1) }),
  async execute(input, ctx) {
    const { tenantId, userId } = requireTenantCaller(ctx);
    return forTenant(
      tenantId,
      async (tx) => {
        const [found] = await tx
          .select({
            id: batches.id,
            status: batches.status,
            updatedAt: batches.updatedAt,
            checksumReport: batches.checksumReport,
            issuer: documents.issuer,
            documentKind: documents.kind,
            periodEnd: batches.periodEnd,
            dueDate: batches.dueDate,
            openingBalance: batches.openingBalance,
            closingBalance: batches.closingBalance,
          })
          .from(batches)
          .innerJoin(documents, eq(documents.id, batches.documentId))
          .where(and(eq(batches.id, input.batchId), eq(batches.tenantId, tenantId)))
          .limit(1);
        if (found === undefined) {
          return notFound("lote_nao_encontrado", `Nenhum documento com o id ${input.batchId}.`);
        }
        if (found.status !== "proposed") {
          return refused("lote_ja_decidido", "Este documento já foi decidido.");
        }

        const countRows = await tx
          .select({ value: count() })
          .from(transactions)
          .where(
            and(
              eq(transactions.batchId, found.id),
              eq(transactions.tenantId, tenantId),
              eq(transactions.status, "proposed"),
            ),
          );
        const transactionCount = countRows[0]?.value ?? 0;
        const verification = found.checksumReport as (ChecksumReport | StatementBalanceReport) | null;
        const statementBalance =
          verification !== null && "kind" in verification && verification.kind === "statement_balance"
            ? verification
            : null;
        const checksum = statementBalance === null ? (verification as ChecksumReport | null) : null;
        const proposalId = `act_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
        const expiresAt = new Date(Date.now() + 30 * 60_000);
        const invoiceLabel = formatDocumentLabel(found);
        const payload = {
          transactionCount,
          checksumResult:
            statementBalance?.result === "match"
              ? "match"
              : statementBalance?.result === "mismatch"
                ? "mismatch"
                : checksum?.result ?? null,
          declaredTotalCents: checksum?.declaredTotal ?? null,
          extractedTotalCents: checksum?.extractedTotal ?? null,
          differenceCents: checksum?.difference ?? null,
          issuer: found.issuer,
          documentKind: found.documentKind,
          invoiceLabel,
          openingBalanceCents: found.openingBalance,
          closingBalanceCents: found.closingBalance,
          statementBalance,
        };
        await tx.insert(financialActionProposals).values({
          id: proposalId,
          tenantId,
          batchId: found.id,
          operation: "register_invoice",
          entityRevision: found.updatedAt,
          payload,
          preparedBy: `human:${userId}`,
          expiresAt,
        });

        return {
          proposalId,
          actionId: proposalId,
          operation: "register_invoice" as const,
          batchId: found.id,
          entityRevision: found.updatedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          issuer: found.issuer,
          documentKind: found.documentKind,
          invoiceLabel,
          openingBalanceCents: found.openingBalance,
          closingBalanceCents: found.closingBalance,
          transactionCount,
          checksumResult:
            statementBalance?.result === "match"
              ? "match"
              : statementBalance?.result === "mismatch"
                ? "mismatch"
                : checksum?.result ?? null,
          declaredTotalCents: checksum?.declaredTotal ?? null,
          extractedTotalCents: checksum?.extractedTotal ?? null,
          extractedTotalFormatted:
            checksum === null ? null : formatCents(checksum.extractedTotal),
          differenceCents: checksum?.difference ?? null,
          ...(statementBalance === null ? {} : { statementBalance }),
          next: "Call commit_batch with this proposalId. Do not ask for a prose confirmation.",
        };
      },
      getDb(),
    );
  },
});
