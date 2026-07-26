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
    "Requests approval to change categories of recorded transactions. Call with the exact affected ids and destination category when the proposal is ready; the approval card is where the person decides.",
  inputSchema: z.object({
    changes: z
      .array(
        z.object({
          transactionId: z.string().min(1),
          category: z
            .string()
            .min(1)
            .describe("Category identifier from the constitution, e.g. 'groceries'."),
          categoryLabel: z
            .string()
            .min(1)
            .describe("Human-readable category label in Brazilian Portuguese, for the approval card."),
        }),
      )
      .min(1)
      .max(500),
    reason: optionalText().describe("Why the reclassification is being made. Write it in Brazilian Portuguese."),
    byConceptId: optionalText().describe("The concept that motivated this, when it came from a learned rule."),
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
        // Categorias válidas vêm dos DOIS bundles: a constituição semeia, e o
        // que a pessoa aprovou depois vale igual. Restringir à constituição
        // tornaria inútil criar categoria nova — ela nunca poderia ser usada.
        const known = await tx
          .select({ conceptId: concepts.conceptId })
          .from(concepts)
          .where(and(eq(concepts.tenantId, tenantId), eq(concepts.type, "Category")));

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
              "Those categories do not exist in the constitution. Use one of the valid ones, or leave the transaction uncategorised.",
          };
        }

        const ids = input.changes.map((change) => change.transactionId);
        // Só transações do razão de verdade: um lote ainda `proposed` se
        // corrige com `edit_proposed_batch`, não por aqui — reclassificar um
        // rascunho gravaria trilha de auditoria para algo que a pessoa ainda
        // nem confirmou.
        const rows = await tx
          .select({ id: transactions.id, category: transactions.category })
          .from(transactions)
          .where(
            and(
              eq(transactions.tenantId, tenantId),
              inArray(transactions.id, ids),
              inArray(transactions.status, ["confirmed", "adjustment"]),
            ),
          );

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
          ...(notFound.length > 0
            ? {
                note: "Ids em notFound não existem OU ainda estão em lote proposto — rascunho se corrige com edit_proposed_batch.",
              }
            : {}),
          auditedBy: `human:${userId}`,
        };
      },
      db,
    );
  },
});
