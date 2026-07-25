import { getDb } from "@clara-financas/db";
import { concepts } from "@clara-financas/db/schema/knowledge";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireTenantCaller } from "../../../lib/tenant";
import { brief, loadLedger } from "../lib/query";

/**
 * Aplica as regras aprendidas às transações ainda sem categoria.
 *
 * Fecha o ciclo da hipótese H4: a pessoa corrige uma vez, a correção vira
 * conceito aprovado, e daqui em diante o sistema aplica sozinho — de forma
 * legível e reversível, porque a regra é um arquivo, não um peso.
 *
 * Note que esta tool **não escreve**: ela devolve o que aplicaria. O analista
 * não tem tools de escrita, por construção. Quem persiste é o coordenador,
 * depois de mostrar à pessoa.
 */
export default defineTool({
  description:
    "Checks which uncategorised transactions the already-learned rules would categorise. Writes nothing — returns what would apply.",
  inputSchema: z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const db = getDb();

    const [ledger, rules] = await Promise.all([
      loadLedger(tenantId, { from: input.from, to: input.to }),
      forTenant(
        tenantId,
        async (tx) =>
          tx
            .select()
            .from(concepts)
            .where(
              and(
                eq(concepts.tenantId, tenantId),
                eq(concepts.bundle, "learnings"),
                eq(concepts.type, "CategorizationRule"),
              ),
            ),
        db,
      ),
    ]);

    if (rules.length === 0) {
      return {
        empty: true as const,
        message: "Ainda não há regras de categorização aprendidas.",
      };
    }

    // A regra referencia a categoria por link markdown absoluto — a sintaxe de
    // cross-link do OKF (§6.1). Ex.: [Assinaturas](/categories/subscriptions.md)
    const parsed = rules.flatMap((rule) => {
      const merchant = typeof rule.frontmatter.merchant === "string"
        ? rule.frontmatter.merchant
        : rule.frontmatter.title;
      const link = /\]\(\/categories\/([a-z0-9-]+)\.md\)/.exec(rule.body);
      if (typeof merchant !== "string" || link === null) return [];
      return [{ conceptId: rule.conceptId, merchant: merchant.toLowerCase(), category: link[1]! }];
    });

    const uncategorized = ledger.filter((transaction) => transaction.category === null);
    const matches = uncategorized.flatMap((transaction) => {
      const haystack = `${transaction.merchant ?? ""} ${transaction.originalDescription}`.toLowerCase();
      const rule = parsed.find((candidate) => haystack.includes(candidate.merchant));
      if (rule === undefined) return [];
      return [{ ...brief(transaction), suggestedCategory: rule.category, byRule: rule.conceptId }];
    });

    return {
      rulesLoaded: parsed.length,
      uncategorizedCount: uncategorized.length,
      matchedCount: matches.length,
      matches,
      // Dito explicitamente para o modelo não anunciar como feito.
      note: "Nothing was written. Present this to the person before recording anything.",
    };
  },
});
