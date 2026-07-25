import { getDb } from "@clara-financas/db";
import { batches, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { merchantKey, verifyChecksum } from "@clara-financas/ledger";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireTenantCaller } from "../lib/tenant";

/**
 * Corrige itens de um lote AINDA EM RASCUNHO e reconfere a soma.
 *
 * Sem gate, e o motivo importa: o gate protege o razão, e rascunho não é
 * razão. Se editar exigisse aprovação, cada correção viraria um ciclo de
 * negar-e-repropor — e o botão "Corrigir" do cartão, que a pessoa usa várias
 * vezes seguidas, ficaria insuportável.
 *
 * O trigger do banco recusa qualquer edição em linha já confirmada, então esta
 * tool não tem como tocar no razão nem por engano.
 */
export default defineTool({
  description:
    "Fixes transactions in a batch that is not yet approved (date, amount, category, merchant) and re-runs the checksum. Use when the person points out an error on the verification card.",
  inputSchema: z.object({
    batchId: z.string().min(1),
    edits: z
      .array(
        z.object({
          transactionId: z.string().min(1),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          amount: z.number().int().optional().describe("IN CENTS, signed."),
          category: z.string().nullable().optional(),
          merchant: z.string().nullable().optional(),
          originalDescription: z.string().min(1).optional(),
        }),
      )
      .min(1),
    removeTransactionIds: z
      .array(z.string().min(1))
      .optional()
      .describe("Items read by mistake that do not exist in the document."),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const db = getDb();

    return forTenant(
      tenantId,
      async (tx) => {
        const [batch] = await tx
          .select()
          .from(batches)
          .where(and(eq(batches.id, input.batchId), eq(batches.tenantId, tenantId)))
          .limit(1);

        if (!batch) return { error: "lote não encontrado" as const };
        if (batch.status !== "proposed") {
          return {
            error: "este lote já foi decidido; correções agora exigem uma linha de ajuste" as const,
          };
        }

        for (const edit of input.edits) {
          const { transactionId, ...fields } = edit;
          const changes: Record<string, unknown> = Object.fromEntries(
            Object.entries(fields).filter(([, value]) => value !== undefined),
          );
          if (Object.keys(changes).length === 0) continue;

          // Corrigir o comerciante tem de corrigir a IDENTIDADE junto. Deixar
          // a chave antiga faria a linha corrigida continuar agrupando com o
          // comerciante errado — e de forma invisível, porque a tela mostra
          // `merchant`, que já estaria certo.
          if (fields.merchant !== undefined || fields.originalDescription !== undefined) {
            const [current] = await tx
              .select({
                merchant: transactions.merchant,
                originalDescription: transactions.originalDescription,
              })
              .from(transactions)
              .where(and(eq(transactions.id, transactionId), eq(transactions.tenantId, tenantId)))
              .limit(1);

            if (current) {
              changes.merchantKey = merchantKey({
                originalDescription: fields.originalDescription ?? current.originalDescription,
                merchant: fields.merchant ?? current.merchant,
              });
            }
          }

          await tx
            .update(transactions)
            .set(changes)
            .where(
              and(
                eq(transactions.id, transactionId),
                eq(transactions.batchId, batch.id),
                eq(transactions.tenantId, tenantId),
                eq(transactions.status, "proposed"),
              ),
            );
        }

        for (const transactionId of input.removeTransactionIds ?? []) {
          await tx
            .delete(transactions)
            .where(
              and(
                eq(transactions.id, transactionId),
                eq(transactions.batchId, batch.id),
                eq(transactions.tenantId, tenantId),
                eq(transactions.status, "proposed"),
              ),
            );
        }

        const rows = await tx
          .select()
          .from(transactions)
          .where(and(eq(transactions.batchId, batch.id), eq(transactions.tenantId, tenantId)));

        const checksum = verifyChecksum({
          documentId: batch.documentId,
          issuer: null,
          periodStart: batch.periodStart,
          periodEnd: batch.periodEnd,
          dueDate: batch.dueDate,
          declaredTotal: batch.declaredTotal,
          // Persistidos no lote: sem eles, reconferir após uma correção
          // perderia a localização e voltaria a dizer só "não bate".
          declaredSubtotals: batch.declaredSubtotals ?? null,
          transactions: rows.map((row) => ({
            id: row.id,
            date: row.date,
            originalDescription: row.originalDescription,
            merchant: row.merchant,
            merchantKey: row.merchantKey,
            amount: row.amount,
            kind: row.kind,
            installment:
              row.installmentCurrent !== null && row.installmentTotal !== null
                ? { current: row.installmentCurrent, total: row.installmentTotal }
                : null,
            category: row.category,
            extractionConfidence: row.extractionConfidence,
            sourceDocument: row.sourceDocumentId,
            page: row.page,
          })),
        });

        await tx
          .update(batches)
          .set({
            extractedTotal: checksum.extractedTotal,
            checksumResult: checksum.result,
            checksumReport: checksum,
          })
          .where(eq(batches.id, batch.id));

        return { batchId: batch.id, transactionCount: rows.length, checksum };
      },
      db,
    );
  },
});
