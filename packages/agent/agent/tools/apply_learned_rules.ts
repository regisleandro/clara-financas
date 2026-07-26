import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { matchRules, parseRules } from "@clara-financas/ledger";
import { concepts } from "@clara-financas/db/schema/knowledge";
import { transactions } from "@clara-financas/db/schema/ledger";
import { transactionReclassifications } from "@clara-financas/db/schema/reclassification";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireTenantCaller, tenantIdOf } from "../lib/tenant";

/**
 * Aplica as regras já aprendidas às transações sem categoria.
 *
 * É a peça que FECHA o ciclo da hipótese H4. Sem ela, o sistema podia aprender
 * uma regra e nunca usá-la: `categorize_by_rules` vive no analista, que é
 * somente leitura por construção, então ninguém tinha como agir sobre o que
 * fora aprendido. Aprendizado que não se aplica não é aprendizado — é anotação.
 *
 * Passa pelo gate porque muda o sentido do razão. Mas a natureza da decisão é
 * diferente da primeira aprovação: aqui a pessoa já disse "sempre categorize
 * assim"; o que ela aprova agora é o alcance — quantas transações a regra pega.
 */
export default defineTool({
  description:
    "Previews or requests approval to apply learned categorisation rules. First call with dryRun=true. If there are matches, call again with the exact expectedTransactionIds from the preview; that call opens the approval card and writes only if the scope is unchanged.",
  inputSchema: z.object({
    dryRun: z
      .boolean()
      .optional()
      .describe(
        "true returns what WOULD be applied, without writing. Use to show the reach before asking for the decision.",
      ),
    expectedTransactionIds: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe("Required for a write: exact transaction ids returned by the immediately preceding dry run."),
  }),

  approval: (ctx) => {
    const current = tenantIdOf(ctx.session.auth.current);
    if (current === undefined || current !== tenantIdOf(ctx.session.auth.initiator)) {
      return { type: "denied", reason: "A sessão não está fixada a um único usuário." };
    }
    // Simulação não escreve nada, então não precisa parar a pessoa.
    const input = ctx.toolInput as { dryRun?: boolean } | undefined;
    return input?.dryRun === true ? "not-applicable" : "user-approval";
  },

  async execute(input, ctx) {
    const { tenantId, userId } = requireTenantCaller(ctx);
    const db = getDb();

    return forTenant(
      tenantId,
      async (tx) => {
        const rules = await tx
          .select()
          .from(concepts)
          .where(
            and(
              eq(concepts.tenantId, tenantId),
              eq(concepts.bundle, "learnings"),
              eq(concepts.type, "CategorizationRule"),
            ),
          );

        if (rules.length === 0) {
          return {
            empty: true as const,
            message:
              "No rule has been learned yet. A rule is born when the person corrects a category and approves keeping the correction.",
          };
        }

        const parsed = parseRules(rules);

        if (parsed.length === 0) {
          return {
            empty: true as const,
            message:
              "The existing rules do not point at a valid category. A rule must reference the category by link, e.g. [Assinaturas](/categories/subscriptions.md).",
          };
        }

        const uncategorized = await tx
          .select({
            id: transactions.id,
            merchant: transactions.merchant,
            originalDescription: transactions.originalDescription,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.tenantId, tenantId),
              isNull(transactions.category),
              inArray(transactions.status, ["confirmed", "adjustment"]),
            ),
          );

        const matches = matchRules(parsed, uncategorized);

        if (input.dryRun === true) {
          return {
            dryRun: true as const,
            rulesLoaded: parsed.length,
            uncategorizedCount: uncategorized.length,
            wouldApply: matches.length,
            matches: matches.slice(0, 20),
            transactionIds: matches.map((match) => match.transactionId),
          };
        }

        const expected = [...(input.expectedTransactionIds ?? [])].sort();
        const actual = matches.map((match) => match.transactionId).sort();
        if (
          expected.length === 0 ||
          expected.length !== actual.length ||
          expected.some((id, index) => id !== actual[index])
        ) {
          return {
            error: "alcance_alterado" as const,
            message:
              "O alcance mudou desde a simulação. Rode dryRun novamente e abra uma nova decisão.",
            expectedCount: expected.length,
            actualCount: actual.length,
          };
        }

        for (const match of matches) {
          await tx
            .update(transactions)
            .set({ category: match.category })
            .where(
              and(
                eq(transactions.id, match.transactionId),
                eq(transactions.tenantId, tenantId),
              ),
            );

          // Regra aplicada também é mudança de leitura: entra na trilha, com o
          // conceito que a originou. É o que permite desfazer depois — desfazer
          // a regra sem saber o que ela mexeu seria desfazer pela metade.
          await tx.insert(transactionReclassifications).values({
            id: `rcl_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
            tenantId,
            transactionId: match.transactionId,
            field: "category",
            previousValue: null,
            newValue: match.category,
            author: `human:${userId}`,
            reason: "regra aprendida aplicada",
            byConceptId: match.byConceptId,
          });
        }

        return {
          rulesLoaded: parsed.length,
          applied: matches.length,
          remainingUncategorized: uncategorized.length - matches.length,
          auditedBy: `human:${userId}`,
        };
      },
      db,
    );
  },
});
