import { getDb } from "@clara-financas/db";
import { transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq, inArray } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireTenantCaller } from "../lib/tenant";

/**
 * O atestado: "uma pessoa olhou isto".
 *
 * A fila de revisão junta o que a extração não fechou — sem categoria, leitura
 * de baixa confiança, sem comerciante. A conclusão mais comum de uma revisão é
 * "a leitura já estava certa", e sem registrar que alguém olhou, a fila
 * devolveria esses mesmos itens para sempre. As colunas existem desde a
 * migração 0015 e só a tela sabia escrevê-las; pela conversa — que é onde a
 * pessoa de fato confere — não havia caminho.
 *
 * Sem gate por construção: não muda nenhum dado financeiro, e é reversível na
 * frase seguinte com `reopen`. O trigger de imutabilidade permite `reviewed_at`
 * em linha confirmada exatamente por isso.
 */
export default defineTool({
  description:
    "Marks entries as reviewed by the person, or reopens them with reopen=true. Use when the conclusion is 'the reading was already right' — without it the review queue keeps handing back the same entries forever. Changes no financial data and needs no approval card.",
  inputSchema: z.object({
    transactionIds: z.array(z.string().min(1)).min(1).max(500),
    reopen: z
      .boolean()
      .optional()
      .describe("true clears the review mark, putting the entries back in the queue."),
  }),

  async execute(input, ctx) {
    const { tenantId, userId } = requireTenantCaller(ctx);
    const reopen = input.reopen === true;

    return forTenant(
      tenantId,
      async (tx) => {
        const touched = await tx
          .update(transactions)
          .set(
            reopen
              ? { reviewedAt: null, reviewedBy: null }
              : { reviewedAt: new Date(), reviewedBy: `human:${userId}` },
          )
          .where(
            and(
              eq(transactions.tenantId, tenantId),
              inArray(transactions.id, input.transactionIds),
              // Rascunho não se atesta: ele ainda vai passar pela decisão do
              // lote inteiro, que é uma conferência mais forte que esta.
              inArray(transactions.status, ["confirmed", "adjustment"]),
            ),
          )
          .returning({ id: transactions.id });

        const done = new Set(touched.map((row) => row.id));
        const missed = input.transactionIds.filter((id) => !done.has(id));

        return {
          [reopen ? "reopened" : "reviewed"]: touched.length,
          notFound: missed,
          ...(missed.length > 0
            ? {
                note: "Ids em notFound não existem OU ainda estão em lote proposto, onde a revisão é a decisão do lote.",
              }
            : {}),
          auditedBy: `human:${userId}`,
        };
      },
      getDb(),
    );
  },
});
