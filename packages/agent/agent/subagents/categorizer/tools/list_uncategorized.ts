import { CATEGORIZABLE_KINDS } from "@clara-financas/db/queries/review";
import { formatCents } from "@clara-financas/ledger";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadCategoryLabels } from "../../../lib/categories";
import { ledgerCoverage, loadLedger } from "../../../lib/ledger-query";
import { requireTenantCaller } from "../../../lib/tenant";

/** O recorte de "gasto a categorizar", como Set para comparar com `kind`. */
const CATEGORIZABLE = new Set<string>(CATEGORIZABLE_KINDS);

/**
 * O gasto sem categoria, agrupado por comerciante e ordenado por impacto.
 *
 * É a tool que torna a triagem 1–2 chamadas em vez de N: o guarda-livros
 * recebe os grupos prontos — total, contagem, grafias observadas e os ids —
 * e propõe UMA categoria por grupo, começando pelo que mais pesa.
 *
 * Pagamentos e ajustes ficam de fora pela mesma razão do snapshot: não são
 * gasto a classificar, e contá-los inflaria a triagem com trabalho que não
 * existe. O recorte é o predicado compartilhado (`CATEGORIZABLE_KINDS`), o
 * mesmo do estado do razão e da fila de revisão: quando cada lugar derivava o
 * seu, a triagem contava um número e o indicador do turno contava outro.
 */
export default defineTool({
  description:
    "Lists uncategorised spending grouped by merchant, largest total first, with the count, the total, the observed spellings and the transaction ids of each group. Use to triage what needs a category, starting where it matters most — and copy each group's count and totalCents into your result, because the coordinator cannot add them up.",
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

    // Mesmo recorte do estado do razão, pelo mesmo predicado (`CATEGORIZABLE_KINDS`):
    // a triagem e o indicador do turno têm de contar as MESMAS linhas.
    const uncategorized = ledger.filter(
      (transaction) => transaction.category === null && CATEGORIZABLE.has(transaction.kind),
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
