import { analyzeFinancialSeries, formatCents } from "@clara-financas/ledger";
import { AnalysisScopeSchema } from "@clara-financas/views/agent-contracts";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { categoryLabel, loadCategoryLabels } from "../../../lib/categories";
import { canonicalAnalysisScope, draftNote, scopeFilter } from "../../../lib/analysis-scope";
import { loadLedger } from "../../../lib/ledger-query";
import { requireTenantCaller } from "../../../lib/tenant";
import { saveAnalysis } from "../lib/save-analysis";

const PeriodInputSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  scope: AnalysisScopeSchema,
});

const InputSchema = z
  .object({
    periods: z.array(PeriodInputSchema).min(2).max(12),
  })
  .superRefine((input, ctx) => {
    const ids = input.periods.map((period) => period.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["periods"], message: "cada período precisa de um id único" });
    }
  });

/**
 * Evolução de vários períodos, em dois painéis.
 *
 * Esta ferramenta publicava numa família de artefato PARALELA
 * (`conversation_artifacts`, `present_financial_artifact`, painel próprio no
 * frontend) por duas razões: o vocabulário de painéis não tinha forma para
 * série, e um artefato v3 podia carregar vários blocos enquanto o recibo do
 * analista só cabia um id. Duas famílias incompatíveis para o mesmo trabalho, e
 * um coordenador aprendendo a rotear entre elas.
 *
 * As duas razões caíram: `ViewSchema` ganhou `series`, e o recibo passou a
 * carregar `artifactIds` no plural. A evolução e os fatores que a explicam
 * viram dois painéis pela via única — a mesma que toda análise usa, com o mesmo
 * guard de reconciliação, do qual esta ferramenta era a única que escapava.
 */
export default defineTool({
  description:
    "Calcula a evolução de gastos em 2 a 12 períodos e mostra os fatores que explicam a mudança. Use para comparar várias faturas, meses ou a evolução ao longo do tempo. Nunca calcule os valores no texto; devolva o recibo do artefato.",
  inputSchema: InputSchema,
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const periods = input.periods.map((period) => ({
      ...period,
      scope: canonicalAnalysisScope(period.scope),
    }));
    const loaded = await Promise.all(
      periods.map(async (period) => ({
        ...period,
        transactions: await loadLedger(tenantId, scopeFilter(period.scope)),
      })),
    );
    const labels = await loadCategoryLabels(tenantId);
    const todos = loaded.flatMap((period) => period.transactions);
    const requestedScope = canonicalAnalysisScope(periods[0]!.scope);

    const empty = loaded.filter((period) => period.transactions.length === 0);
    if (empty.length > 0) {
      // Comparar contra o vazio produziria "subiu tudo" a partir de zero. É uma
      // resposta completa dizer que não dá para comparar, e qual lado falta.
      const names = empty.map((period) => period.label).join(", ");
      return saveAnalysis(
        {
          kind: "metric",
          title: "Evolução dos gastos",
          summary: `A evolução não foi calculada: ${names} não possui lançamentos. Nenhum total foi estimado.`,
          metric: {
            label: "Resultado",
            text: "Dados insuficientes",
            detail: `Sem lançamentos em: ${names}.`,
            basis: "count",
            transactionIds: [],
          },
          rows: [],
        },
        requestedScope,
        ctx,
        [],
        ["periodo_vazio"],
      );
    }

    const series = analyzeFinancialSeries(loaded);
    const first = series.points[0]!;
    const last = series.points.at(-1)!;
    const edgeIds = [...new Set([...first.transactionIds, ...last.transactionIds])];

    /*
     * Painel 1 — a série.
     *
     * As linhas são os PONTOS: um por período, cada um somando os próprios
     * lançamentos. O destaque é a variação entre o primeiro e o último, que é
     * uma diferença — e por isso os pontos não somam o destaque, nem deveriam.
     * `series` não é forma aditiva justamente por isso.
     */
    const painelDaSerie = await saveAnalysis(
      {
        kind: "series",
        title: "Evolução dos gastos",
        summary: `${first.label} → ${last.label}. A série foi calculada diretamente do razão.${draftNote(todos)}`,
        metric: {
          label: "Variação no período",
          amount: series.totalDelta,
          basis: "delta",
          detail: `${formatCents(first.value)} → ${formatCents(last.value)}`,
          transactionIds: edgeIds,
        },
        rows: series.points.map((point) => ({
          label: point.label,
          amount: point.value,
          transactionIds: point.transactionIds,
        })),
      },
      requestedScope,
      ctx,
      todos,
    );
    if ("error" in painelDaSerie) return painelDaSerie;

    // Um recorte só de pagamentos e transferências não tem fatores a explicar:
    // a série sozinha é a resposta completa.
    if (series.drivers.length === 0) return painelDaSerie;

    /*
     * Painel 2 — o que explica a mudança.
     *
     * `comparison` é a forma certa: cada linha é a variação de uma categoria
     * entre o primeiro e o último período, e as variações somam a variação
     * total — invariante que o guard verifica.
     *
     * Como em `compare_periods`, a contribuição para o AUMENTO vai por extenso
     * e não como `share`: a base dela são só os aumentos, não o número em
     * destaque, e desenhá-la como proporção do delta líquido produziria barra
     * de 100% ao lado de uma diferença pequena.
     */
    const painelDosFatores = await saveAnalysis(
      {
        kind: "comparison",
        title: "O que explica a mudança",
        summary: `Fatores entre ${first.label} e ${last.label}.`,
        previousLabel: first.label,
        currentLabel: last.label,
        metric: {
          label: "Variação no período",
          amount: series.totalDelta,
          basis: "delta",
          detail: `${formatCents(first.value)} → ${formatCents(last.value)}`,
          transactionIds: edgeIds,
        },
        rows: series.drivers.slice(0, 20).map((driver) => ({
          label: categoryLabel(labels, driver.category),
          amount: driver.delta,
          basis: "delta" as const,
          detail: `${driver.delta > 0 ? "Aumentou" : driver.delta < 0 ? "Diminuiu" : "Estável"}${
            driver.delta > 0 && driver.shareOfChange > 0
              ? ` · ${Math.round(driver.shareOfChange * 100)}% do aumento`
              : ""
          }`,
          trend:
            driver.delta > 0 ? ("up" as const) : driver.delta < 0 ? ("down" as const) : ("flat" as const),
          transactionIds: driver.transactionIds,
        })),
      },
      requestedScope,
      ctx,
      todos,
    );
    if ("error" in painelDosFatores) return painelDosFatores;

    // Um recibo só, com os dois painéis na ordem de apresentação.
    return {
      artifactIds: [...painelDaSerie.artifactIds, ...painelDosFatores.artifactIds],
      artifactKind: "analysis" as const,
      nextAction: "present_analysis" as const,
      viewKinds: [...painelDaSerie.viewKinds, ...painelDosFatores.viewKinds],
      warnings: [...painelDaSerie.warnings, ...painelDosFatores.warnings],
    };
  },
});
