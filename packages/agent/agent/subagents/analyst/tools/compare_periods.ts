import { comparePeriods, formatCents, totalSpend } from "@clara-financas/ledger";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { categoryLabel, loadCategoryLabels } from "../../../lib/categories";
import { optionalText } from "../../../lib/schema";
import { requireTenantCaller } from "../../../lib/tenant";
import { ledgerCoverage, loadLedger } from "../../../lib/ledger-query";

/**
 * Comparação entre dois períodos.
 *
 * `shareOfChange` é o número que sustenta a frase "restaurantes explicam 62%
 * do aumento": contribuição da categoria para a variação, não a variação dela
 * isolada. É a diferença entre explicar e apenas listar.
 */
export default defineTool({
  description:
    "Compares spending across two periods by category and shows what accounts for the change. Use for 'por que subiu', 'comparado ao mês passado'.",
  inputSchema: z.object({
    // Duas formas de recortar, e a de FATURA é a preferida quando a pergunta
    // é sobre faturas. Ciclos consecutivos se tocam na virada do mês (uma
    // termina em 31/05, a outra começa em 31/05), então recortar por data
    // contava a mesma compra dos dois lados e produzia uma variação que não
    // existia.
    currentBatchId: optionalText().describe(
      "Invoice to use as the CURRENT period, by batchId. Preferred over dates when comparing invoices.",
    ),
    previousBatchId: optionalText().describe(
      "Invoice to use as the PREVIOUS period, by batchId.",
    ),
    currentFrom: optionalText().describe("Start of the current period, YYYY-MM-DD."),
    currentTo: optionalText().describe("End of the current period, YYYY-MM-DD, inclusive."),
    previousFrom: optionalText().describe("Start of the previous period, YYYY-MM-DD."),
    previousTo: optionalText().describe("End of the previous period, YYYY-MM-DD, inclusive."),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);

    const currentIsSet = input.currentBatchId !== undefined || input.currentFrom !== undefined;
    const previousIsSet = input.previousBatchId !== undefined || input.previousFrom !== undefined;

    if (!currentIsSet || !previousIsSet) {
      // Falhar com instrução é melhor que comparar contra um recorte vazio e
      // devolver uma variação de 100% que o modelo apresentaria como fato.
      return {
        error: "recorte_incompleto" as const,
        message:
          "Comparison needs BOTH sides. Pass currentBatchId + previousBatchId (preferred), or currentFrom/currentTo + previousFrom/previousTo. The invoices available are in the ledger state.",
      };
    }

    const [current, previous] = await Promise.all([
      loadLedger(tenantId, {
        from: input.currentFrom,
        to: input.currentTo,
        batchId: input.currentBatchId,
      }),
      loadLedger(tenantId, {
        from: input.previousFrom,
        to: input.previousTo,
        batchId: input.previousBatchId,
      }),
    ]);

    // Por LADO, não `&&`: um recorte que existe mas voltou vazio (batchId
    // rejeitado, mês em que a fatura não caiu) fazia a comparação rodar com
    // previousTotal = 0 — e o modelo apresentava "subiu" contra uma base
    // inexistente. Exatamente o que o guard acima tenta evitar.
    if (current.length === 0 || previous.length === 0) {
      return {
        warning: "lado_vazio" as const,
        emptySides: {
          current: current.length === 0,
          previous: previous.length === 0,
        },
        // O que o razão de fato cobre, para o modelo corrigir o recorte em
        // vez de concluir que não há nada registrado.
        ledgerCoverage: await ledgerCoverage(tenantId),
        message:
          "One side of the comparison returned no transactions. Do NOT present any variation — check the batchIds or date ranges against the ledger state and try again, or tell the person which side has no data.",
      };
    }

    const { totalDelta, categories } = comparePeriods(current, previous);
    const labels = await loadCategoryLabels(tenantId);

    return {
      // Qual recorte foi de fato usado — sem isso a resposta diz "subiu 12%"
      // sem dizer em relação a quê, e a pessoa não tem como conferir.
      compared: {
        current: input.currentBatchId ?? `${input.currentFrom ?? "?"} a ${input.currentTo ?? "?"}`,
        previous:
          input.previousBatchId ?? `${input.previousFrom ?? "?"} a ${input.previousTo ?? "?"}`,
      },
      currentTotal: {
        cents: totalSpend(current).value,
        formatted: formatCents(totalSpend(current).value),
      },
      previousTotal: {
        cents: totalSpend(previous).value,
        formatted: formatCents(totalSpend(previous).value),
      },
      totalDelta: { cents: totalDelta, formatted: formatCents(totalDelta) },
      categories: categories.map((entry) => ({
        category: entry.category,
        label: categoryLabel(labels, entry.category),
        currentCents: entry.current.value,
        previousCents: entry.previous.value,
        deltaCents: entry.delta,
        deltaFormatted: formatCents(entry.delta),
        deltaPercent:
          entry.deltaRatio === null ? null : Math.round(entry.deltaRatio * 1000) / 10,
        // Quanto esta categoria explica do AUMENTO total.
        explainsPercentOfIncrease: Math.round(entry.shareOfChange * 1000) / 10,
        currentTransactionIds: entry.current.transactionIds,
        previousTransactionIds: entry.previous.transactionIds,
      })),
    };
  },
});
