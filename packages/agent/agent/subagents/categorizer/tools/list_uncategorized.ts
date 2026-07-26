import { formatCents } from "@clara-financas/ledger";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadCategoryLabels } from "../../../lib/categories";
import { ledgerCoverage, loadLedger } from "../../../lib/ledger-query";
import { requireTenantCaller } from "../../../lib/tenant";

/**
 * O gasto sem categoria, agrupado por comerciante e ordenado por impacto.
 *
 * É a tool que torna a triagem 1–2 chamadas em vez de N: o guarda-livros
 * recebe os grupos prontos — total, contagem, grafias observadas e os ids —
 * e propõe UMA categoria por grupo, começando pelo que mais pesa.
 *
 * Pagamentos e ajustes ficam de fora pela mesma razão do snapshot: não são
 * gasto a classificar, e contá-los inflaria a triagem com trabalho que não
 * existe.
 */
export default defineTool({
  description:
    "Lists uncategorised spending grouped by merchant, largest total first, with the observed spellings and transaction ids. Use to triage what needs a category, starting where it matters most.",
  inputSchema: z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    batchId: z.string().optional().describe("Restrict to one invoice, by the batch that recorded it."),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);

    const ledger = await loadLedger(tenantId, {
      from: input.from,
      to: input.to,
      batchId: input.batchId,
    });

    const uncategorized = ledger.filter(
      (transaction) =>
        transaction.category === null &&
        (transaction.kind === "purchase" ||
          transaction.kind === "refund" ||
          transaction.kind === "fee"),
    );

    if (uncategorized.length === 0) {
      return {
        empty: true as const,
        message: "Não há gasto sem categoria no recorte pedido.",
        // O vazio é ambíguo: razão em dia, ou recorte que errou o alvo? A
        // cobertura deixa o modelo distinguir sem mandar a pessoa reenviar
        // um documento que já está lá.
        ledgerCoverage: await ledgerCoverage(tenantId),
      };
    }

    // Agrupa pela identidade derivada (`merchantKey`), não pela grafia: o
    // mesmo comerciante aparece escrito de um jeito em cada fatura, e a
    // triagem por grafia proporia a mesma categoria três vezes.
    const groups = new Map<
      string,
      { totalCents: number; spellings: Set<string>; transactionIds: string[] }
    >();
    for (const transaction of uncategorized) {
      const key = transaction.merchantKey ?? transaction.originalDescription.toLowerCase();
      const group = groups.get(key) ?? {
        totalCents: 0,
        spellings: new Set<string>(),
        transactionIds: [],
      };
      group.totalCents += transaction.amount;
      group.spellings.add(transaction.merchant ?? transaction.originalDescription);
      group.transactionIds.push(transaction.id);
      groups.set(key, group);
    }

    const labels = await loadCategoryLabels(tenantId);

    return {
      uncategorizedCount: uncategorized.length,
      totalCents: uncategorized.reduce((sum, transaction) => sum + transaction.amount, 0),
      groups: [...groups.values()]
        .sort((a, b) => b.totalCents - a.totalCents)
        .map((group) => ({
          // A primeira grafia é o rótulo que a pessoa reconhece; as demais
          // são pistas de alias (mesma empresa escrita diferente).
          merchant: [...group.spellings][0]!,
          spellings: [...group.spellings],
          count: group.transactionIds.length,
          totalCents: group.totalCents,
          totalFormatted: formatCents(group.totalCents),
          transactionIds: group.transactionIds,
        })),
      // Os identificadores válidos viajam junto para a proposta nunca
      // inventar categoria — entre uma categoria errada e nenhuma, nenhuma.
      validCategories: Object.entries(labels).map(([id, label]) => ({ id, label })),
      note: "Nothing was written. Propose one category per group, with the transaction ids.",
    };
  },
});
