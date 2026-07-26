import { getDb } from "@clara-financas/db";
import { batches, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { notFound, refused } from "../lib/errors";
import { requireTenantCaller, tenantIdOf } from "../lib/tenant";

/**
 * Descartar uma fatura proposta.
 *
 * O botão "Rejeitar" do cartão de conferência existia na interface e não tinha
 * tool por trás: ele mandava a FRASE "Descarte o lote X. Não quero registrar
 * essa fatura." para o chat. A Clara então respondia que tinha descartado — e
 * nada acontecia no banco. O lote seguia `proposed` para sempre, reaparecendo
 * no snapshot de todo turno e na lista de faturas como pendência viva.
 *
 * O status `rejected` já existia no schema desde o começo, sem nenhum código
 * que o escrevesse.
 */
export default defineTool({
  description:
    "Requests approval to discard a proposed invoice that will not be recorded. Use when the person says the invoice is wrong, duplicated, or that they do not want it. The draft entries are removed and the batch is marked as rejected, so it stops showing up as pending.",
  inputSchema: z.object({
    batchId: z.string().min(1),
    reason: z
      .string()
      .min(1)
      .describe("Why it is being discarded, in Brazilian Portuguese. Shown on the card."),
  }),

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
        const [batch] = await tx
          .select()
          .from(batches)
          .where(and(eq(batches.id, input.batchId), eq(batches.tenantId, tenantId)))
          .limit(1);

        if (batch === undefined) {
          return notFound("lote_nao_encontrado", `Nenhuma fatura com o id ${input.batchId}.`, {
            hint: "Confira os batchId do estado do razão, ou chame list_invoices.",
          });
        }
        if (batch.status === "rejected") {
          return {
            batchId: batch.id,
            status: "rejected" as const,
            alreadyRejected: true as const,
          };
        }
        if (batch.status === "confirmed") {
          return refused(
            "lote_ja_registrado",
            "Esta fatura já está no razão, e o que foi registrado não se apaga.",
            {
              hint: "Para corrigir um valor dela, chame create_adjustment. Para revisar item a item, chame read_batch.",
            },
          );
        }

        // Apagar só as linhas em rascunho — as confirmadas nem chegam aqui, mas
        // o filtro explícito é o que garante que o trigger de imutabilidade
        // nunca precise recusar nada.
        const removed = await tx
          .delete(transactions)
          .where(
            and(
              eq(transactions.batchId, batch.id),
              eq(transactions.tenantId, tenantId),
              eq(transactions.status, "proposed"),
            ),
          )
          .returning({ id: transactions.id });

        await tx
          .update(batches)
          .set({ status: "rejected", approvedBy: `human:${userId}`, approvedAt: new Date() })
          .where(and(eq(batches.id, batch.id), eq(batches.tenantId, tenantId)));

        return {
          batchId: batch.id,
          status: "rejected" as const,
          discardedTransactions: removed.length,
          reason: input.reason,
          auditedBy: `human:${userId}`,
          // O documento fica: reenviar o mesmo PDF é barrado pelo hash, e sem
          // esta nota o modelo prometeria um reenvio que a deduplicação recusa.
          note: "O documento continua registrado; para propor de novo a partir dele, use propose_batch.",
        };
      },
      getDb(),
    );
  },
});
