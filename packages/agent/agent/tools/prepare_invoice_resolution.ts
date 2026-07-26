import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { financialActionProposals } from "@clara-financas/db/schema/financial-action";
import { batches, documents, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { formatCents, type ChecksumReport } from "@clara-financas/ledger";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { notFound, refused } from "../lib/errors";
import { invoiceResolutionPlan } from "../lib/financial-actions";
import { requireTenantCaller } from "../lib/tenant";

const expiresInMinutes = 30;

/**
 * Calcula e congela a proposta de fechamento de uma divergência.
 *
 * O sinal nunca vem do modelo: `difference = extraído - declarado`, portanto
 * o único delta que zera a conferência é `-difference`.
 */
export default defineTool({
  description:
    "Prepares a canonical proposal to close the current difference of one already-recorded invoice. The tool calculates the sign and amount; never calculate or invert it yourself. After showing the proposal, call apply_invoice_resolution with only its proposalId to open the Eve approval gate.",
  inputSchema: z.object({
    batchId: z.string().min(1),
    targetTransactionId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional real entry this adjustment explains. Omit for invoice-level rounding or when no specific entry caused the difference.",
      ),
    reason: z.string().min(1).describe("Motivo em português que ficará na trilha de auditoria."),
  }),
  async execute(input, ctx) {
    const { tenantId, userId } = requireTenantCaller(ctx);

    return forTenant(
      tenantId,
      async (tx) => {
        const [batch] = await tx
          .select({
            id: batches.id,
            status: batches.status,
            documentId: batches.documentId,
            periodEnd: batches.periodEnd,
            dueDate: batches.dueDate,
            updatedAt: batches.updatedAt,
            checksumReport: batches.checksumReport,
            issuer: documents.issuer,
            filename: documents.filename,
          })
          .from(batches)
          .innerJoin(documents, eq(documents.id, batches.documentId))
          .where(and(eq(batches.id, input.batchId), eq(batches.tenantId, tenantId)))
          .limit(1);

        if (batch === undefined) {
          return notFound("lote_nao_encontrado", `Nenhuma fatura com o id ${input.batchId}.`, {
            hint: "Chame list_invoices para obter o batchId atual.",
          });
        }
        if (batch.status !== "confirmed") {
          return refused(
            "operacao_nao_permitida",
            "A fatura ainda é rascunho; corrija as linhas antes de registrá-la.",
            { hint: "Use edit_proposed_batch para uma fatura em rascunho." },
          );
        }

        const report = batch.checksumReport as ChecksumReport | null;
        const difference = report?.difference ?? null;
        const plan = invoiceResolutionPlan(difference);
        if (report === null || report.result !== "mismatch" || plan === null) {
          return refused(
            "fatura_sem_divergencia",
            "Esta fatura não tem uma diferença aberta que peça ajuste.",
            { hint: "Chame read_batch para ler a conferência atual." },
          );
        }

        let target: typeof transactions.$inferSelect | undefined;
        if (input.targetTransactionId !== undefined) {
          [target] = await tx
            .select()
            .from(transactions)
            .where(
              and(
                eq(transactions.id, input.targetTransactionId),
                eq(transactions.batchId, batch.id),
                eq(transactions.tenantId, tenantId),
              ),
            )
            .limit(1);
          if (target === undefined) {
            return notFound(
              "lancamento_nao_encontrado",
              "O lançamento indicado não pertence a esta fatura.",
              { hint: "Use um id retornado por read_batch ou omita o alvo." },
            );
          }
        }

        const proposalId = `act_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
        const adjustmentCents = plan.adjustmentCents;
        const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);
        const payload = {
          adjustmentCents,
          differenceBeforeCents: plan.differenceBeforeCents,
          differenceAfterExpectedCents: plan.differenceAfterExpectedCents,
          targetTransactionId: target?.id ?? null,
          targetDescription: target?.originalDescription ?? null,
          reason: input.reason,
          issuer: batch.issuer,
          filename: batch.filename,
          effectiveDate: target?.date ?? batch.periodEnd ?? batch.dueDate,
        };

        await tx.insert(financialActionProposals).values({
          id: proposalId,
          tenantId,
          batchId: batch.id,
          operation: "resolve_invoice_difference",
          entityRevision: batch.updatedAt,
          payload,
          preparedBy: `human:${userId}`,
          expiresAt,
        });

        return {
          proposalId,
          actionId: proposalId,
          operation: "resolve_invoice_difference" as const,
          batchId: batch.id,
          entityRevision: batch.updatedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          issuer: batch.issuer,
          filename: batch.filename,
          targetTransactionId: target?.id ?? null,
          targetDescription: target?.originalDescription ?? null,
          differenceBeforeCents: plan.differenceBeforeCents,
          differenceBeforeFormatted: formatCents(plan.differenceBeforeCents),
          adjustmentCents,
          adjustmentFormatted: formatCents(adjustmentCents),
          differenceAfterExpectedCents: 0,
          reason: input.reason,
          next:
            "Call apply_invoice_resolution with this proposalId. Do not ask for a prose confirmation.",
        };
      },
      getDb(),
    );
  },
});
