import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { transactions } from "@clara-financas/db/schema/ledger";
import { transactionReclassifications } from "@clara-financas/db/schema/reclassification";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq, inArray } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { categoryLabel, loadCategoryLabels } from "../lib/categories";
import { loadValidCategories, unknownCategory } from "../lib/category-scope";
import { notFound } from "../lib/errors";
import { optionalText } from "../lib/schema";
import { requireTenantCaller } from "../lib/tenant";

/**
 * A correção de UM lançamento, sem cartão de aprovação.
 *
 * A escrita em lote (`recategorize_transactions`) tem gate porque muda o
 * sentido do razão inteiro: dezenas de linhas de uma vez, e a pessoa precisa
 * ver o alcance antes. Uma linha só é outra coisa — é a pessoa dizendo "esse
 * aí é mercado" no meio da conversa. Abrir um cartão para confirmar o que ela
 * acabou de pedir transforma um acerto de dois segundos numa cerimônia, e o
 * efeito prático observado é que a correção deixa de ser feita.
 *
 * O que NÃO é dispensado: a trilha. A mudança grava em
 * `transaction_reclassifications` como qualquer outra, com autor, valor
 * anterior e motivo — e a resposta devolve o que é preciso para desfazer,
 * porque escrita sem cartão precisa ser reversível na frase seguinte.
 */
export default defineTool({
  description:
    "Sets the category of ONE recorded entry, right away, without an approval card. Use when the person names the category for a specific entry during the conversation. For many entries at once use recategorize_transactions, which opens the card. The response carries what is needed to undo it.",
  inputSchema: z.object({
    transactionId: z.string().min(1),
    category: z
      .string()
      .nullable()
      .describe(
        "Category identifier. Pass null to clear it — between a wrong category and none, leave none.",
      ),
    reason: optionalText().describe("Why, in Brazilian Portuguese. Shown in the learning trail."),
  }),

  async execute(input, ctx) {
    const { tenantId, userId } = requireTenantCaller(ctx);

    // Os rótulos são carregados ANTES de abrir a transação, e não é estilo:
    // `loadCategoryLabels` abre o seu próprio `forTenant`, e o pool do banco é
    // `max: 1`. Chamá-lo lá dentro trava a conexão contra si mesma — a tool
    // fica pendurada para sempre, sem erro, e o turno morre em silêncio.
    const labels = await loadCategoryLabels(tenantId);

    return forTenant(
      tenantId,
      async (tx) => {
        if (input.category !== null) {
          const valid = await loadValidCategories(tx, tenantId);
          if (!valid.has(input.category)) return unknownCategory([input.category], valid);
        }

        const [row] = await tx
          .select({ id: transactions.id, category: transactions.category })
          .from(transactions)
          .where(
            and(
              eq(transactions.tenantId, tenantId),
              eq(transactions.id, input.transactionId),
              inArray(transactions.status, ["confirmed", "adjustment"]),
            ),
          )
          .limit(1);

        if (row === undefined) {
          return notFound(
            "lancamento_nao_encontrado",
            `Nenhum lançamento registrado com o id ${input.transactionId}.`,
            {
              hint: "Ele pode estar num lote ainda em rascunho — nesse caso a correção é com edit_proposed_batch.",
            },
          );
        }

        const previous = row.category;
        if (previous === input.category) {
          return { transactionId: row.id, changed: false as const, category: previous };
        }

        await tx
          .update(transactions)
          .set({ category: input.category })
          .where(and(eq(transactions.id, row.id), eq(transactions.tenantId, tenantId)));

        await tx.insert(transactionReclassifications).values({
          id: `rcl_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
          tenantId,
          transactionId: row.id,
          field: "category",
          previousValue: previous,
          newValue: input.category,
          author: `human:${userId}`,
          reason: input.reason ?? null,
          byConceptId: null,
        });

        return {
          transactionId: row.id,
          changed: true as const,
          previousCategory: previous,
          previousLabel: categoryLabel(labels, previous),
          category: input.category,
          categoryLabel: categoryLabel(labels, input.category),
          auditedBy: `human:${userId}`,
          // Desfazer é a mesma tool com o valor anterior: sem isto, "volta como
          // estava" exigiria que o modelo lembrasse de um valor que ele não
          // tem mais no contexto.
          undo: { tool: "set_transaction_category", transactionId: row.id, category: previous },
        };
      },
      getDb(),
    );
  },
});
