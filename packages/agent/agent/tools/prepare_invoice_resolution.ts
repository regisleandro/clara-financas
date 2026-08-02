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
    "Prepares a canonical proposal to close the current difference of one already-recorded invoice. The tool calculates the sign and amount; never calculate or invert it yourself. targetTransactionId is optional metadata: an id that is not an entry of this invoice is IGNORED and reported back in targetIgnored — the proposal still exists, at invoice level. After showing the proposal, call apply_invoice_resolution with only its proposalId to open the Eve approval gate.",
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
            documentKind: documents.kind,
          })
          .from(batches)
          .innerJoin(documents, eq(documents.id, batches.documentId))
          .where(and(eq(batches.id, input.batchId), eq(batches.tenantId, tenantId)))
          .limit(1);

        if (batch === undefined) {
          return notFound("lote_nao_encontrado", `Nenhum documento com o id ${input.batchId}.`, {
            hint: "Chame list_invoices para obter o batchId atual.",
          });
        }
        if (batch.status !== "confirmed") {
          return refused(
            "operacao_nao_permitida",
            "O documento ainda é rascunho; corrija as linhas antes de registrá-lo.",
            { hint: "Use edit_proposed_batch para uma fatura em rascunho." },
          );
        }

        const report = batch.checksumReport as (ChecksumReport | StatementBalanceReport) | null;
        if (report !== null && "kind" in report && report.kind === "statement_balance") {
          return refused(
            "operacao_nao_permitida",
            "Extratos são reconciliados pelo saldo inicial e final, não por ajuste de fatura.",
            { hint: "Use read_batch para conferir o saldo e create_adjustment para uma correção explícita." },
          );
        }
        const checksum = report as ChecksumReport | null;
        const difference = checksum?.difference ?? null;
        const plan = invoiceResolutionPlan(difference);
        if (checksum === null || checksum.result !== "mismatch" || plan === null) {
          return refused(
            "fatura_sem_divergencia",
            "Esta fatura não tem uma diferença aberta que peça ajuste.",
            { hint: "Chame read_batch para ler a conferência atual." },
          );
        }

        /**
         * Alvo inválido NÃO cancela o ajuste.
         *
         * O alvo é metadado: o delta sai de `invoiceResolutionPlan`, que só
         * olha a diferença da conferência. Recusar por causa dele travava a
         * correção inteira num caso em que o próprio relatório diz que não há
         * culpado (`likelyCause: "rounding"`) — e o modelo, sem `read_batch`
         * naquele turno, tende a oferecer o id que tem à mão, que é o da
         * fatura. O resultado observado foi um laço: mesma chamada, mesmo
         * erro, a cada "faça isso" da pessoa.
         *
         * Então a proposta segue no nível da fatura e o alvo descartado fica
         * registrado — na resposta, para o modelo dizer o que foi feito, e no
         * payload, para a auditoria enxergar o que havia sido pedido.
         */
        let target: typeof transactions.$inferSelect | undefined;
        let targetIgnored: { requestedId: string; reason: string } | null = null;
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
            targetIgnored = {
              requestedId: input.targetTransactionId,
              reason:
                "O id indicado não é um lançamento desta fatura; o ajuste foi preparado no nível da fatura.",
            };
          }
        }

        const proposalId = `act_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
        const adjustmentCents = plan.adjustmentCents;
        const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);
        const invoiceLabel = formatDocumentLabel(batch);
        const payload = {
          adjustmentCents,
          differenceBeforeCents: plan.differenceBeforeCents,
          differenceAfterExpectedCents: plan.differenceAfterExpectedCents,
          targetTransactionId: target?.id ?? null,
          targetDescription: target?.originalDescription ?? null,
          targetIgnored,
          reason: input.reason,
          issuer: batch.issuer,
          invoiceLabel,
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
          invoiceLabel,
          targetTransactionId: target?.id ?? null,
          targetDescription: target?.originalDescription ?? null,
          targetIgnored,
          differenceBeforeCents: plan.differenceBeforeCents,
          differenceBeforeFormatted: formatCents(plan.differenceBeforeCents),
          adjustmentCents,
          adjustmentFormatted: formatCents(adjustmentCents),
          differenceAfterExpectedCents: 0,
          reason: input.reason,
          next:
            targetIgnored === null
              ? "Call apply_invoice_resolution with this proposalId. Do not ask for a prose confirmation."
              : "The target was ignored and the proposal is invoice-level. Call apply_invoice_resolution with this proposalId anyway — do not prepare again and do not ask for a prose confirmation.",
        };
      },
      getDb(),
    );
  },
});
