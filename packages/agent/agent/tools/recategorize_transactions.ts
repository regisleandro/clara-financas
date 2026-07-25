import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { concepts } from "@clara-financas/db/schema/knowledge";
import { transactions } from "@clara-financas/db/schema/ledger";
import { transactionReclassifications } from "@clara-financas/db/schema/reclassification";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq, inArray } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { optionalText } from "../lib/schema";
import { requireTenantCaller, tenantIdOf } from "../lib/tenant";

/**
 * Reclassifica transações já confirmadas.
 *
 * Passa pelo gate porque muda o SENTIDO do razão: toda análise por categoria
 * enxerga outra coisa depois disto. Não muda os fatos — valor, data, descrição
 * e origem seguem intocáveis, garantido pelo trigger do banco.
 *
 * Cada mudança grava uma linha em `transaction_reclassifications`, que é
 * append-only. Reclassificar é permitido; reclassificar em silêncio, não.
 */
export default defineTool({
  description:
    "Muda a categoria de transações já registradas no razão. Exige aprovação. Use quando as categorias estiverem erradas ou fora da taxonomia da constituição.",
  inputSchema: z.object({
    changes: z
      .array(
        z.object({
          transactionId: z.string().min(1),
          category: z
            .string()
            .min(1)
            .describe("Identificador da categoria na constituição, ex.: 'groceries'."),
        }),
      )
      .min(1)
      .max(500),
    reason: optionalText().describe("Por que a reclassificação está sendo feita."),
    byConceptId: optionalText().describe("Conceito que motivou, se veio de uma regra aprendida."),
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
    const db = getDb();

    return forTenant(
      tenantId,
      async (tx) => {
        // Só categorias que existem na constituição. Sem esta checagem, a
        // recategorização poderia reintroduzir taxonomia inventada — que é
        // exatamente o problema que ela veio resolver.
        const known = await tx
          .select({ conceptId: concepts.conceptId })
          .from(concepts)
          .where(
            and(
              eq(concepts.tenantId, tenantId),
              eq(concepts.bundle, "constitution"),
              eq(concepts.type, "Category"),
            ),
          );

        const valid = new Set(
          known.map((row) => row.conceptId.replace(/^categories\//, "")),
        );

        const invalid = [...new Set(input.changes.map((c) => c.category))].filter(
          (category) => !valid.has(category),
        );
        if (invalid.length > 0) {
          return {
            error: "categoria_desconhecida" as const,
            invalid,
            validCategories: [...valid].sort(),
            message:
              "Essas categorias não existem na constituição. Use uma das válidas ou deixe a transação sem categoria.",
          };
        }

        const ids = input.changes.map((change) => change.transactionId);
        const rows = await tx
          .select({ id: transactions.id, category: transactions.category })
          .from(transactions)
          .where(and(eq(transactions.tenantId, tenantId), inArray(transactions.id, ids)));

        const currentById = new Map(rows.map((row) => [row.id, row.category]));
        let changed = 0;
        let unchanged = 0;
        const notFound: string[] = [];

        for (const change of input.changes) {
          if (!currentById.has(change.transactionId)) {
            notFound.push(change.transactionId);
            continue;
          }

          const previous = currentById.get(change.transactionId) ?? null;
          if (previous === change.category) {
            unchanged += 1;
            continue;
          }

          await tx
            .update(transactions)
            .set({ category: change.category })
            .where(
              and(
                eq(transactions.id, change.transactionId),
                eq(transactions.tenantId, tenantId),
              ),
            );

          await tx.insert(transactionReclassifications).values({
            id: `rcl_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
            tenantId,
            transactionId: change.transactionId,
            field: "category",
            previousValue: previous,
            newValue: change.category,
            author: `human:${userId}`,
            reason: input.reason ?? null,
            byConceptId: input.byConceptId ?? null,
          });

          changed += 1;
        }

        return {
          changed,
          unchanged,
          notFound,
          auditedBy: `human:${userId}`,
        };
      },
      db,
    );
  },
});
