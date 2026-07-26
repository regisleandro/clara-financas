import { getDb } from "@clara-financas/db";
import { concepts } from "@clara-financas/db/schema/knowledge";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { matchRules, parseRules } from "@clara-financas/ledger";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadCategoryLabels } from "../../../lib/categories";
import { brief, ledgerCoverage, loadLedger } from "../../../lib/ledger-query";
import { requireTenantCaller } from "../../../lib/tenant";

/**
 * Aplica as regras aprendidas às transações ainda sem categoria.
 *
 * Fecha o ciclo da hipótese H4: a pessoa corrige uma vez, a correção vira
 * conceito aprovado, e daqui em diante o sistema aplica sozinho — de forma
 * legível e reversível, porque a regra é um arquivo, não um peso.
 *
 * O parse e o casamento vêm de `@clara-financas/ledger` (`parseRules` /
 * `matchRules`), NUNCA de um parser local: a versão anterior desta tool
 * reimplementava o parse e divergiu do domínio — uma regra com `merchant`
 * vazio passava no guard e `includes("")` casava com o razão inteiro.
 *
 * Note que esta tool **não escreve**: ela devolve o que aplicaria. O
 * guarda-livros não tem tools de escrita, por construção. Quem persiste é o
 * coordenador, depois de mostrar à pessoa.
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

    const [ledger, rules, labels] = await Promise.all([
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
      loadCategoryLabels(tenantId),
    ]);

    if (rules.length === 0) {
      return {
        empty: true as const,
        message: "Ainda não há regras de categorização aprendidas.",
      };
    }

    const parsed = parseRules(rules);
    const uncategorized = ledger.filter((transaction) => transaction.category === null);

    if (uncategorized.length === 0) {
      return {
        empty: true as const,
        message: "Não há transações sem categoria no recorte pedido.",
        ledgerCoverage: await ledgerCoverage(tenantId),
      };
    }

    const byId = new Map(uncategorized.map((transaction) => [transaction.id, transaction]));
    const matches = matchRules(parsed, uncategorized).flatMap((match) => {
      const transaction = byId.get(match.transactionId);
      if (transaction === undefined) return [];
      return [
        {
          ...brief(transaction, labels),
          suggestedCategory: match.category,
          suggestedCategoryLabel: labels[match.category] ?? match.category,
          byRule: match.byConceptId,
        },
      ];
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
