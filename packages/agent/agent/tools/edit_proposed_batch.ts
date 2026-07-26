import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { batches, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { CONFIDENCE, ENTRY_KINDS, merchantKey } from "@clara-financas/ledger";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { notFound, refused } from "../lib/errors";
import { recomputeBatchChecksum } from "../lib/recompute-checksum";
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
    "Fixes transactions in a batch that is not yet approved and re-runs the checksum. Corrects date, amount, kind, category, merchant, description and confidence; removes entries read by mistake; adds entries the extraction missed. Use when the verification does not add up, or when the person points out an error on the card. Entry ids come from read_batch.",
  inputSchema: z
    .object({
      batchId: z.string().min(1),
      edits: z
        .array(
          z.object({
            transactionId: z.string().min(1),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            amount: z.number().int().optional().describe("IN CENTS, signed."),
            // `kind` faltava, e era a correção mais necessária de todas: é ele
            // que decide se a linha compõe o total da fatura. Um pagamento lido
            // como compra produz divergência do tamanho exato do pagamento — a
            // causa mais documentada do repositório — e não havia como corrigir.
            kind: z
              .enum(ENTRY_KINDS)
              .optional()
              .describe(
                "Nature of the entry. `payment` does NOT count toward the invoice total; fixing a payment read as a purchase usually closes the whole difference.",
              ),
            extractionConfidence: z.enum(CONFIDENCE).optional(),
            category: z.string().nullable().optional(),
            merchant: z.string().nullable().optional(),
            originalDescription: z.string().min(1).optional(),
          }),
        )
        .optional(),
      removeTransactionIds: z
        .array(z.string().min(1))
        .optional()
        .describe("Items read by mistake that do not exist in the document."),
      // Faltava o caminho inverso da remoção: quando a conferência acusa item
      // FALTANTE, a única saída era reextrair o PDF inteiro.
      add: z
        .array(
          z.object({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            originalDescription: z.string().min(1),
            amount: z.number().int().describe("IN CENTS, signed."),
            merchant: z.string().nullable().optional(),
            kind: z.enum(ENTRY_KINDS).optional(),
            category: z.string().nullable().optional(),
            page: z.number().int().positive().nullable().optional(),
          }),
        )
        .optional()
        .describe("Entries present in the document that the extraction missed."),
    })
    .refine(
      (input) =>
        (input.edits?.length ?? 0) > 0 ||
        (input.removeTransactionIds?.length ?? 0) > 0 ||
        (input.add?.length ?? 0) > 0,
      // `edits` era obrigatório com `.min(1)`, o que proibia a operação mais
      // comum de uma divergência tipo "item": só REMOVER a linha duplicada. O
      // modelo tinha de inventar uma edição no-op para conseguir remover.
      { message: "informe ao menos uma correção, remoção ou inclusão" },
    ),
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

        if (!batch) {
          return notFound("lote_nao_encontrado", `Nenhuma fatura com o id ${input.batchId}.`, {
            hint: "Confira os batchId do estado do razão, ou chame list_invoices.",
          });
        }
        if (batch.status !== "proposed") {
          return refused(
            "lote_ja_decidido",
            "Esta fatura já foi registrada no razão, e lançamento confirmado não se edita.",
            {
              hint: "Para corrigir algo aqui, chame create_adjustment com o transactionId e o valor da correção.",
            },
          );
        }

        for (const edit of input.edits ?? []) {
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

        for (const entry of input.add ?? []) {
          await tx.insert(transactions).values({
            id: `txn_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
            tenantId,
            batchId: batch.id,
            sourceDocumentId: batch.documentId,
            status: "proposed",
            date: entry.date,
            originalDescription: entry.originalDescription,
            merchant: entry.merchant ?? null,
            merchantKey: merchantKey({
              originalDescription: entry.originalDescription,
              merchant: entry.merchant ?? null,
            }),
            amount: entry.amount,
            kind: entry.kind ?? "purchase",
            category: entry.category ?? null,
            // Item acrescentado à mão não foi lido pelo extrator: a confiança
            // é da correção humana que o trouxe, e marcá-lo como `alta` faria
            // a fila de revisão perder de vista o que não veio do documento.
            extractionConfidence: "media",
            page: entry.page ?? null,
          });
        }

        const { checksum, transactionCount } = await recomputeBatchChecksum(tx, tenantId, batch);

        return {
          batchId: batch.id,
          transactionCount,
          checksum,
          // O que mudou é o que a Clara vai contar para a pessoa; deduzir do
          // input daria número errado quando um id não casa com o lote.
          applied: {
            edited: input.edits?.length ?? 0,
            removed: input.removeTransactionIds?.length ?? 0,
            added: input.add?.length ?? 0,
          },
        };
      },
      db,
    );
  },
});
