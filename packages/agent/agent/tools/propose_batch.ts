import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { batches, documents, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { ProposedBatchSchema, verifyChecksum } from "@clara-financas/ledger";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireTenantCaller } from "../lib/tenant";

/**
 * Grava o lote proposto pelo extrator como RASCUNHO e roda a conferência.
 *
 * Sem gate de aprovação, de propósito: um rascunho não é o razão. Nada
 * auditável foi tocado, e o trigger do banco só protege linhas já confirmadas.
 *
 * É esta separação que faz o cartão de conferência funcionar: "Corrigir" mexe
 * livremente no rascunho, e o gate incide uma vez só, sobre o estado final já
 * revisado — o que torna a decisão binária de aprovar honesta.
 */
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

export default defineTool({
  description:
    "Registra como rascunho as transações extraídas de um documento e confere a soma contra o total declarado. Use logo após o extrator devolver o lote. Nada entra no razão aqui — só depois da aprovação da pessoa.",
  inputSchema: z.object({
    documentId: z.string().min(1),
    issuer: z.string().nullable().optional(),
    periodStart: z.string().nullable().optional(),
    periodEnd: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    declaredTotal: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe("Total declarado no documento, EM CENTAVOS. null se o documento não declara."),
    transactions: z.array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        originalDescription: z.string().min(1),
        merchant: z.string().nullable().optional(),
        amount: z
          .number()
          .int()
          .describe("EM CENTAVOS, sinalizado: despesa > 0, crédito (pagamento/estorno) < 0."),
        kind: z.enum(["purchase", "payment", "refund", "fee", "adjustment"]).optional(),
        installment: z
          .object({ current: z.number().int().positive(), total: z.number().int().positive() })
          .nullable()
          .optional(),
        category: z.string().nullable().optional(),
        extractionConfidence: z.enum(["alta", "media", "baixa"]),
        page: z.number().int().positive().nullable().optional(),
      }),
    ),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const db = getDb();

    const document = await forTenant(
      tenantId,
      async (tx) => {
        const [row] = await tx
          .select()
          .from(documents)
          .where(and(eq(documents.id, input.documentId), eq(documents.tenantId, tenantId)))
          .limit(1);
        return row;
      },
      db,
    );

    if (!document) return { error: "documento não encontrado" as const };

    const batchId = id("bat");
    const prepared = input.transactions.map((transaction) => ({
      ...transaction,
      id: id("txn"),
      merchant: transaction.merchant ?? null,
      kind: transaction.kind ?? ("purchase" as const),
      installment: transaction.installment ?? null,
      category: transaction.category ?? null,
      page: transaction.page ?? null,
      sourceDocument: document.id,
    }));

    // Revalidação no executor. O modelo produziu estes dados; confiar neles
    // sem passar pelo schema seria deixar o modelo definir o formato do razão.
    const batch = ProposedBatchSchema.parse({
      documentId: document.id,
      issuer: input.issuer ?? document.issuer ?? null,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      dueDate: input.dueDate ?? null,
      declaredTotal: input.declaredTotal ?? null,
      transactions: prepared,
    });

    const checksum = verifyChecksum(batch);

    await forTenant(
      tenantId,
      async (tx) => {
        await tx.insert(batches).values({
          id: batchId,
          tenantId,
          documentId: document.id,
          status: "proposed",
          periodStart: batch.periodStart,
          periodEnd: batch.periodEnd,
          dueDate: batch.dueDate,
          declaredTotal: batch.declaredTotal,
          extractedTotal: checksum.extractedTotal,
          checksumResult: checksum.result,
          checksumReport: checksum,
        });

        if (batch.transactions.length > 0) {
          await tx.insert(transactions).values(
            batch.transactions.map((transaction) => ({
              id: transaction.id,
              tenantId,
              batchId,
              status: "proposed" as const,
              date: transaction.date,
              originalDescription: transaction.originalDescription,
              merchant: transaction.merchant,
              amount: transaction.amount,
              kind: transaction.kind,
              installmentCurrent: transaction.installment?.current ?? null,
              installmentTotal: transaction.installment?.total ?? null,
              category: transaction.category,
              extractionConfidence: transaction.extractionConfidence,
              sourceDocumentId: document.id,
              page: transaction.page,
            })),
          );
        }
      },
      db,
    );

    return {
      batchId,
      status: "proposed" as const,
      transactionCount: batch.transactions.length,
      checksum,
    };
  },
});
