import { getDb } from "@clara-financas/db";
import { batches, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { notFound, refused } from "../lib/errors";
import { requireTenantCaller, tenantIdOf } from "../lib/tenant";

/**
 * O GATE.
 *
 * Esta é a única porta entre o rascunho e o razão, e ela para o turno até uma
 * pessoa decidir. `approval: always()` estaciona a execução em
 * `session.waiting` de forma durável — pode ficar aberta por dias, sem
 * consumir compute, e retoma exatamente onde parou.
 *
 * Duas coisas que a documentação do eve deixa explícitas e que este executor
 * respeita:
 *
 *  1. **Aprovação é gate, não autorização.** Quem aprovou apenas tinha acesso
 *     à sessão. Então revalidamos tenant e estado aqui dentro, depois do sim.
 *  2. **A política pode mudar enquanto o turno está estacionado.** Por isso a
 *     verificação acontece no momento da execução, não no da proposta.
 */
export default defineTool({
  description:
    "Requests approval to record a verified draft batch in the ledger. Call when the verification is ready for the person's decision: the call opens the approval card, pauses, and executes only after approval. Do not ask for a prose confirmation first.",
  inputSchema: z.object({
    batchId: z.string().min(1).describe("Id of the proposed batch, as returned by propose_batch."),
  }),

  approval: (ctx) => {
    const current = tenantIdOf(ctx.session.auth.current);
    const initiator = tenantIdOf(ctx.session.auth.initiator);

    // Sessão que não está fixada a um único tenant não aprova nada. Cobre o
    // caso de um chamador diferente retomar uma sessão estacionada — que é
    // possível, porque `auth.current` acompanha o turno e `auth.initiator`
    // permanece em quem criou a sessão.
    if (current === undefined || current !== initiator) {
      return { type: "denied", reason: "A sessão não está fixada a um único usuário." };
    }

    // Equivalente a `always()`, na forma documentada de política: pausa o
    // turno e espera uma pessoa. Usar a string evita depender do formato
    // interno que o helper retorna.
    return "user-approval";
  },

  async execute(input, ctx) {
    const { tenantId, userId } = requireTenantCaller(ctx);
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

        // Idempotência: um replay do passo durável não pode confirmar duas
        // vezes. O trigger do banco também barraria, mas falhar aqui dá uma
        // resposta útil em vez de um erro de constraint.
        if (batch.status === "confirmed") {
          return { batchId: batch.id, status: "confirmed" as const, alreadyConfirmed: true };
        }
        if (batch.status === "rejected") {
          return refused(
            "lote_ja_decidido",
            "Esta fatura foi descartada e não pode ser registrada.",
            {
              hint: "Para registrar este documento, proponha um lote novo com propose_batch a partir da extração.",
            },
          );
        }

        const updated = await tx
          .update(transactions)
          .set({ status: "confirmed" })
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
          .set({
            status: "confirmed",
            approvedBy: `human:${userId}`,
            approvedAt: new Date(),
          })
          .where(eq(batches.id, batch.id));

        return {
          batchId: batch.id,
          status: "confirmed" as const,
          confirmedTransactions: updated.length,
          checksumResult: batch.checksumResult,
        };
      },
      db,
    );
  },
});
