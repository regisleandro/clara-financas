import { getDb } from "@clara-financas/db";
import { concepts } from "@clara-financas/db/schema/knowledge";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { CATEGORIZABLE_KINDS } from "@clara-financas/db/queries/review";
import { formatCents, matchRules, parseRules } from "@clara-financas/ledger";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadCategoryLabels } from "../../../lib/categories";
import { brief, ledgerCoverage, loadLedger } from "../../../lib/ledger-query";
import { requireTenantCaller } from "../../../lib/tenant";

/** O recorte de "gasto a categorizar", como Set para comparar com `kind`. */
const CATEGORIZABLE = new Set<string>(CATEGORIZABLE_KINDS);

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
    "Checks which uncategorised transactions the already-learned rules would categorise. Writes nothing — returns what would apply, grouped by rule with the count and total of each group.",
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
    // O MESMO recorte do estado do razão: sem o filtro de natureza, esta tool
    // contava pagamento e ajuste como trabalho pendente e devolvia um
    // `uncategorizedCount` maior que o do bloco lido no início do turno — dois
    // números para a mesma pergunta, no mesmo contexto.
    const uncategorized = ledger.filter(
      (transaction) => transaction.category === null && CATEGORIZABLE.has(transaction.kind),
    );

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

    // Agrupado por REGRA, com o total já somado aqui: é a forma que o output do
    // guarda-livros pede (`matchedRules` carrega `count` e `totalCents`), e ele
    // não pode somar — modelo somando dinheiro é como um número errado entra
    // numa resposta com cara de certa.
    const byRule = new Map<
      string,
      {
        conceptId: string;
        categoryId: string;
        categoryLabel: string;
        count: number;
        totalCents: number;
        transactionIds: string[];
      }
    >();
    for (const match of matches) {
      const group = byRule.get(match.byRule) ?? {
        conceptId: match.byRule,
        categoryId: match.suggestedCategory,
        categoryLabel: match.suggestedCategoryLabel,
        count: 0,
        totalCents: 0,
        transactionIds: [],
      };
      group.count += 1;
      group.totalCents += match.amountCents;
      group.transactionIds.push(match.id);
      byRule.set(match.byRule, group);
    }

    return {
      rulesLoaded: parsed.length,
      uncategorizedCount: uncategorized.length,
      uncategorizedTotalCents: uncategorized.reduce((sum, entry) => sum + entry.amount, 0),
      matchedCount: matches.length,
      matches,
      rules: [...byRule.values()]
        .sort((a, b) => b.totalCents - a.totalCents)
        .map((group) => ({ ...group, totalFormatted: formatCents(group.totalCents) })),
      // Dito explicitamente para o modelo não anunciar como feito.
      note: "Nothing was written. Present this to the person before recording anything. Copy count and totalCents from `rules` into matchedRules — do not add them up yourself.",
    };
  },
});
