import { comparePeriods, formatCents, totalSpend } from "@clara-financas/ledger";
import { ComparableAnalysisScopeSchema } from "@clara-financas/views/agent-contracts";
import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  canonicalAnalysisScope,
  draftNote,
  scopeFilter,
  scopeLabel,
} from "../../../lib/analysis-scope";
import { categoryLabel, loadCategoryLabels } from "../../../lib/categories";
import { requireTenantCaller } from "../../../lib/tenant";
import { ledgerCoverage, loadLedger } from "../../../lib/ledger-query";
import { saveAnalysis } from "../lib/save-analysis";

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
    current: ComparableAnalysisScopeSchema,
    previous: ComparableAnalysisScopeSchema,
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const currentScope = canonicalAnalysisScope(input.current);
    const previousScope = canonicalAnalysisScope(input.previous);
    const requestedScope = {
      kind: "comparison" as const,
      current: currentScope,
      previous: previousScope,
    };

    const [current, previous] = await Promise.all([
      loadLedger(tenantId, scopeFilter(currentScope)),
      loadLedger(tenantId, scopeFilter(previousScope)),
    ]);

    // Por LADO, não `&&`: um recorte que existe mas voltou vazio (batchId
    // rejeitado, mês em que a fatura não caiu) fazia a comparação rodar com
    // previousTotal = 0 — e o modelo apresentava "subiu" contra uma base
    // inexistente. Exatamente o que o guard acima tenta evitar.
    if (current.length === 0 || previous.length === 0) {
      const coverage = await ledgerCoverage(tenantId);
      const empty = [
        ...(current.length === 0 ? [`atual (${scopeLabel(currentScope)})`] : []),
        ...(previous.length === 0 ? [`anterior (${scopeLabel(previousScope)})`] : []),
      ].join(" e ");
      return saveAnalysis(
        {
          kind: "metric",
          title: "Comparação indisponível",
          summary: `O lado ${empty} não possui lançamentos; nenhum delta foi calculado.`,
          metric: {
            label: "Resultado",
            text: "Dados insuficientes",
            detail:
              coverage.count === 0
                ? "O razão ainda não possui lançamentos confirmados."
                : `A cobertura disponível vai de ${coverage.firstDate} a ${coverage.lastDate}.`,
            transactionIds: [],
          },
          rows: [],
        },
        requestedScope,
        ctx,
        [],
        ["lado_vazio"],
      );
    }

    const { totalDelta, categories } = comparePeriods(current, previous);
    const labels = await loadCategoryLabels(tenantId);
    const currentTotal = totalSpend(current);
    const previousTotal = totalSpend(previous);
    const totalIds = [...new Set([...currentTotal.transactionIds, ...previousTotal.transactionIds])];

    return saveAnalysis(
      {
        kind: "comparison",
        title: "Comparação de gastos",
        summary: `A variação e suas causas foram calculadas diretamente do razão.${draftNote([...current, ...previous])}`,
        previousLabel: scopeLabel(previousScope),
        currentLabel: scopeLabel(currentScope),
        metric: {
          label: "Diferença",
          amount: totalDelta,
          // Diferença, não soma: os ids são a união dos dois lados, e sem
          // declarar isso quem confere tentaria somá-los para chegar ao valor.
          basis: "delta" as const,
          detail: `${formatCents(previousTotal.value)} → ${formatCents(currentTotal.value)}`,
          transactionIds: totalIds,
        },
        rows: categories.map((entry) => ({
          label: categoryLabel(labels, entry.category),
          amount: entry.delta,
          basis: "delta" as const,
          /*
           * A contribuição vai como TEXTO, com a base nomeada — e `share` não
           * é emitido.
           *
           * `share` tem contrato: "vira barra de proporção", isto é, fração do
           * número em destaque. `shareOfChange` tem outro denominador (só os
           * aumentos, porque misturar quedas diluiria a explicação), então
           * emiti-lo ali entregava ao painel uma fração de uma base que ele não
           * mostra. O resultado era uma barra de 100% ao lado de "Diferença
           * R$ 2,00" — matematicamente defensável, visualmente uma mentira.
           *
           * E o número não se perdia por acaso: `view-panel.tsx` desenha barra
           * só em `breakdown`, então o valor que sustenta "restaurantes
           * explicam 62% do aumento" existia no dado e não aparecia em lugar
           * nenhum. Dito por extenso, ele aparece e diz de que é fração.
           */
          detail: `${formatCents(entry.previous.value)} → ${formatCents(entry.current.value)}${
            entry.delta > 0 && entry.shareOfChange > 0
              ? ` · ${Math.round(entry.shareOfChange * 100)}% do aumento`
              : ""
          }`,
          trend: entry.delta > 0 ? "up" : entry.delta < 0 ? "down" : "flat",
          transactionIds: [
            ...new Set([...entry.current.transactionIds, ...entry.previous.transactionIds]),
          ],
        })),
      },
      requestedScope,
      ctx,
      // A testemunha é o razão dos DOIS lados: numa comparação a proveniência
      // de cada linha é a união do período atual com o anterior, e conferir
      // contra um só reprovaria o painel certo.
      [...current, ...previous],
    );
  },
});
