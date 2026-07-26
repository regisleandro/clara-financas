import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { financialActionProposals } from "@clara-financas/db/schema/financial-action";
import { batches, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { formatCents, type ChecksumReport } from "@clara-financas/ledger";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { notFound, refused } from "../lib/errors";
import { invoiceResolutionPlan, sameRevision } from "../lib/financial-actions";
import { recomputeBatchChecksum } from "../lib/recompute-checksum";
import { requireTenantCaller, tenantIdOf } from "../lib/tenant";

type ResolutionPayload = {
  adjustmentCents: number;
  differenceBeforeCents: number;
  differenceAfterExpectedCents: 0;
  targetTransactionId: string | null;
  targetDescription: string | null;
  reason: string;
  effectiveDate: string | null;
};

export default defineTool({
  description:
    "Opens the Eve approval gate for a prepared invoice-resolution proposal. Call with the exact proposalId returned by prepare_invoice_resolution. Execution revalidates the invoice revision and current difference, is idempotent, and returns a canonical receipt.",
  inputSchema: z.object({ proposalId: z.string().min(1) }),
  approval: (ctx) => {
    const current = tenantIdOf(ctx.session.auth.current);
    if (current === undefined || current !== tenantIdOf(ctx.session.auth.initiator)) {
      return { type: "denied", reason: "A sessão não está fixada a um único usuário." };
    }
    return "user-approval";
  },
  async execute(input, ctx) {
    const { tenantId, userId } = requireTenantCaller(ctx);

    return forTenant(
      tenantId,
      async (tx) => {
        const [proposal] = await tx
          .select()
          .from(financialActionProposals)
          .where(
            and(
              eq(financialActionProposals.id, input.proposalId),
              eq(financialActionProposals.tenantId, tenantId),
            ),
          )
          .limit(1);

        if (proposal === undefined || proposal.operation !== "resolve_invoice_difference") {
          return notFound("proposta_nao_encontrada", "Esta proposta de ajuste não existe.", {
            hint: "Prepare uma nova proposta com prepare_invoice_resolution.",
          });
        }
        if (proposal.status === "applied" && proposal.receipt !== null) {
          return { ...proposal.receipt, alreadyApplied: true };
        }
        if (proposal.status !== "prepared") {
          return refused("proposta_ja_decidida", "Esta proposta já foi encerrada.");
        }
        if (proposal.expiresAt.getTime() <= Date.now()) {
          return refused("proposta_expirada", "A fatura pode ter mudado desde esta proposta.", {
            hint: "Prepare uma nova proposta para usar os valores atuais.",
          });
        }

        const [batch] = await tx
          .select()
          .from(batches)
          .where(and(eq(batches.id, proposal.batchId), eq(batches.tenantId, tenantId)))
          .limit(1);
        if (batch === undefined) {
          return notFound("lote_nao_encontrado", "A fatura desta proposta não existe mais.");
        }
        if (
          !sameRevision(batch.updatedAt, proposal.entityRevision) ||
          batch.status !== "confirmed"
        ) {
          return refused(
            "proposta_desatualizada",
            "A fatura mudou depois que esta proposta foi preparada; nada foi aplicado.",
            { hint: "Leia a fatura e prepare uma nova proposta." },
          );
        }

        const payload = proposal.payload as ResolutionPayload;
        const report = batch.checksumReport as ChecksumReport | null;
        const currentDifference = report?.difference ?? null;
        const currentPlan = invoiceResolutionPlan(currentDifference);
        if (
          report?.result !== "mismatch" ||
          currentDifference !== payload.differenceBeforeCents ||
          currentPlan === null ||
          payload.adjustmentCents !== currentPlan.adjustmentCents
        ) {
          return refused(
            "proposta_desatualizada",
            "A diferença atual não é mais a que foi aprovada; nada foi aplicado.",
            { hint: "Prepare uma nova proposta para recalcular o ajuste." },
          );
        }

        const target =
          payload.targetTransactionId === null
            ? undefined
            : (
                await tx
                  .select()
                  .from(transactions)
                  .where(
                    and(
                      eq(transactions.id, payload.targetTransactionId),
                      eq(transactions.batchId, batch.id),
                      eq(transactions.tenantId, tenantId),
                    ),
                  )
                  .limit(1)
              )[0];
        if (payload.targetTransactionId !== null && target === undefined) {
          return refused(
            "proposta_desatualizada",
            "O lançamento relacionado à proposta não está mais disponível.",
            { hint: "Prepare uma nova proposta sem alvo ou escolha outra linha." },
          );
        }

        const adjustmentId = `txn_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
        const inserted = await tx
          .insert(transactions)
          .values({
            id: adjustmentId,
            tenantId,
            batchId: batch.id,
            sourceDocumentId: batch.documentId,
            status: "adjustment",
            adjustsTransactionId: target?.id ?? null,
            actionId: proposal.id,
            date:
              payload.effectiveDate ??
              target?.date ??
              batch.periodEnd ??
              batch.dueDate ??
              new Date().toISOString().slice(0, 10),
            originalDescription: `Ajuste de conferência: ${payload.reason}`,
            merchant: target?.merchant ?? null,
            merchantKey: target?.merchantKey ?? null,
            amount: payload.adjustmentCents,
            kind: "adjustment",
            category: target?.category ?? null,
            extractionConfidence: "alta",
            reviewedAt: new Date(),
            reviewedBy: `human:${userId}`,
          })
          .onConflictDoNothing({
            target: [transactions.tenantId, transactions.actionId],
          })
          .returning({ id: transactions.id });

        const effectiveAdjustmentId =
          inserted[0]?.id ??
          (
            await tx
              .select({ id: transactions.id })
              .from(transactions)
              .where(
                and(
                  eq(transactions.tenantId, tenantId),
                  eq(transactions.actionId, proposal.id),
                ),
              )
              .limit(1)
          )[0]?.id;

        if (effectiveAdjustmentId === undefined) {
          throw new Error("Não foi possível localizar o ajuste idempotente.");
        }

        const { checksum } = await recomputeBatchChecksum(tx, tenantId, batch);
        if (checksum.result !== "match" || checksum.difference !== 0) {
          throw new Error("O ajuste calculado não zerou a conferência; a operação foi revertida.");
        }

        const receipt = {
          actionId: proposal.id,
          mutationId: effectiveAdjustmentId,
          proposalId: proposal.id,
          batchId: batch.id,
          operation: "resolve_invoice_difference" as const,
          revisionBefore: proposal.entityRevision.toISOString(),
          adjustmentCents: payload.adjustmentCents,
          adjustmentFormatted: formatCents(payload.adjustmentCents),
          differenceBeforeCents: payload.differenceBeforeCents,
          differenceAfterCents: checksum.difference,
          status: "applied" as const,
          canUndo: false,
          auditedBy: `human:${userId}`,
        };

        await tx
          .update(financialActionProposals)
          .set({
            status: "applied",
            receipt,
            appliedBy: `human:${userId}`,
            appliedAt: new Date(),
          })
          .where(
            and(
              eq(financialActionProposals.id, proposal.id),
              eq(financialActionProposals.status, "prepared"),
            ),
          );

        return receipt;
      },
      getDb(),
    );
  },
});
