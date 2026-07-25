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
    issuer: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Quem emitiu o documento, como aparece nele — 'Nubank', 'Itaú'. Preencha sempre que o documento identificar: é o título do cartão de conferência.",
      ),
    periodStart: z.string().nullable().optional(),
    periodEnd: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    declaredTotal: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe("Total declarado no documento, EM CENTAVOS. null se o documento não declara."),
    declaredSubtotals: z
      .object({
        fees: z.number().int().nullable().optional(),
        purchases: z.number().int().nullable().optional(),
      })
      .nullable()
      .optional()
      .describe(
        'Subtotais do RESUMO da fatura, em centavos: "IOF de compras internacionais" em `fees`, "Total de compras" em `purchases`. É o que permite dizer ONDE está uma divergência.',
      ),
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

    // Idempotência por documento: reprocessar a mesma fatura NÃO pode criar um
    // segundo rascunho. Sem isto, cada tentativa deixava um lote órfão — foram
    // 5 lotes e 374 transações fantasmas do mesmo PDF em teste real, e a
    // análise passou a somar coisa que a pessoa nunca aprovou.
    await forTenant(
      tenantId,
      async (tx) => {
        const stale = await tx
          .select({ id: batches.id })
          .from(batches)
          .where(
            and(
              eq(batches.tenantId, tenantId),
              eq(batches.documentId, document.id),
              eq(batches.status, "proposed"),
            ),
          );

        for (const row of stale) {
          // Só rascunho sai; o trigger do banco protege o que foi confirmado.
          await tx.delete(transactions).where(eq(transactions.batchId, row.id));
          await tx.delete(batches).where(eq(batches.id, row.id));
        }
      },
      db,
    );

    // Documento já registrado no razão: propor de novo duplicaria o gasto.
    const confirmed = await forTenant(
      tenantId,
      async (tx) => {
        const [row] = await tx
          .select({ id: batches.id })
          .from(batches)
          .where(
            and(
              eq(batches.tenantId, tenantId),
              eq(batches.documentId, document.id),
              eq(batches.status, "confirmed"),
            ),
          )
          .limit(1);
        return row;
      },
      db,
    );

    if (confirmed) {
      return {
        error: "documento_ja_registrado" as const,
        batchId: confirmed.id,
        message:
          "Esta fatura já foi registrada no razão. Não proponha de novo — se algo está errado, registre um ajuste.",
      };
    }

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
      declaredSubtotals:
        input.declaredSubtotals == null
          ? null
          : {
              fees: input.declaredSubtotals.fees ?? null,
              purchases: input.declaredSubtotals.purchases ?? null,
            },
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
          declaredSubtotals: batch.declaredSubtotals,
          extractedTotal: checksum.extractedTotal,
          checksumResult: checksum.result,
          checksumReport: checksum,
        });

        // O emissor mora no documento, não no lote — é propriedade do papel,
        // não da tentativa de leitura. Sem gravar aqui, ele se perdia entre a
        // extração e a tela, e a conferência aparecia intitulada "Documento"
        // mesmo com a Clara sabendo que era uma fatura do Nubank.
        if (batch.issuer !== null && document.issuer === null) {
          await tx
            .update(documents)
            .set({ issuer: batch.issuer })
            .where(and(eq(documents.id, document.id), eq(documents.tenantId, tenantId)));
        }

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
      // O emissor volta no retorno porque é dele que a tela tira o título do
      // cartão. Calculado aqui e não devolvido é o mesmo que não calculado.
      issuer: batch.issuer,
      transactionCount: batch.transactions.length,
      checksum,
      next: "Se a conferência estiver boa, chame `commit_batch` para abrir a decisão. Não pergunte em texto se pode registrar.",
    };
  },
});
