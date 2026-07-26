import { getDb } from "@clara-financas/db";
import { transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq, inArray } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireTenantCaller, tenantIdOf } from "../lib/tenant";

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
 * Poucas linhas passam sem gate: não muda nenhum dado financeiro e é
 * reversível na frase seguinte com `reopen`. Mas o atestado em MASSA é outra
 * coisa — "marquei as 500 como revisadas" esvazia a fila inteira com uma
 * frase, e ninguém olhou 500 linhas numa frase. Acima do limiar, o cartão
 * aparece: é o mesmo argumento de escala que separa
 * `set_transaction_category` de `recategorize_transactions`. Reabrir nunca
 * exige cartão — devolver itens à fila é a direção segura.
 */
const NO_CARD_LIMIT = 20;

export default defineTool({
  description:
    "Marks entries as reviewed by the person, or reopens them with reopen=true. Use when the conclusion is 'the reading was already right' — without it the review queue keeps handing back the same entries forever. Changes no financial data. Up to 20 entries apply directly; more than that opens the approval card, because attesting in bulk empties the queue.",
  inputSchema: z.object({
    transactionIds: z.array(z.string().min(1)).min(1).max(500),
    reopen: z
      .boolean()
      .optional()
      .describe("true clears the review mark, putting the entries back in the queue."),
  }),

  approval: (ctx) => {
    const current = tenantIdOf(ctx.session.auth.current);
    if (current === undefined || current !== tenantIdOf(ctx.session.auth.initiator)) {
      return { type: "denied", reason: "A sessão não está fixada a um único usuário." };
    }
    const input = ctx.toolInput as
      | { transactionIds?: string[]; reopen?: boolean }
      | undefined;
    // Reabrir devolve à fila — direção segura, nunca pede cartão. Atestar em
    // massa esvazia a fila, e isso a pessoa decide.
    const count = input?.transactionIds?.length ?? 0;
    return input?.reopen !== true && count > NO_CARD_LIMIT ? "user-approval" : "not-applicable";
  },

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
