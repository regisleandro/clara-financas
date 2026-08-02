import {
  analyzeFinancialSeries,
  formatCents,
  type FinancialPeriod,
} from "@clara-financas/ledger";
import {
  FinancialArtifactSchema,
  FinancialScopeV3Schema,
} from "@clara-financas/views";
import { AnalysisScopeSchema } from "@clara-financas/views/agent-contracts";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { categoryLabel, loadCategoryLabels } from "../../../lib/categories";
import { canonicalAnalysisScope, scopeFilter } from "../../../lib/analysis-scope";
import { loadLedger } from "../../../lib/ledger-query";
import {
  createGoal,
  createTask,
  publishArtifact,
  settleTask,
  updateGoalStatus,
} from "../../../lib/v3-state";
import { requireSessionCaller } from "../../../lib/tenant";

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
 * Evolução de vários períodos em um único artefato.
 *
 * A ferramenta é deliberadamente pequena: o modelo escolhe os recortes e os
 * rótulos, o razão calcula os pontos e os drivers. Assim uma pergunta sobre as
 * três últimas faturas não vira três chamadas independentes nem exige que a
 * Clara faça aritmética no contexto.
 */
export default defineTool({
  description:
    "Calcula a evolução de gastos em 2 a 12 períodos e mostra os fatores que explicam a mudança. Use para comparar várias faturas, meses ou a evolução ao longo do tempo. Nunca calcule os valores no texto; devolva o recibo do artefato.",
  inputSchema: InputSchema,
  async execute(input, ctx) {
    const { tenantId } = requireSessionCaller(ctx);
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
    const artifactScope = FinancialScopeV3Schema.parse({
      kind: "periods",
      periods: periods.map(({ id, label, scope }) => ({ id, label, scope })),
    });
    const goal = await createGoal(
      {
        intent: "Comparar a evolução dos gastos entre vários períodos.",
        entities: [],
        scope: artifactScope,
        completionCriteria: [
          "calcular todos os períodos solicitados",
          "explicar os principais fatores da variação",
          "publicar um artefato financeiro com proveniência",
        ],
      },
      ctx,
    );
    const task = await createTask(
      {
        goalId: goal.goalId,
        specialist: "analysis",
        objective: "Calcular a série e os fatores que explicam a mudança.",
        contextRefs: periods.map((period) => period.id),
        completionCriteria: ["nenhum total calculado pelo modelo", "todos os blocos com proveniência"],
        status: "running",
      },
      ctx,
    );
    const labels = await loadCategoryLabels(tenantId);
    const empty = loaded.filter((period) => period.transactions.length === 0);

    if (empty.length > 0) {
      const names = empty.map((period) => period.label).join(", ");
      const artifact = await publishArtifact(
        {
          kind: "timeline",
          title: "Evolução dos gastos",
          summary: "A evolução não foi calculada porque um dos períodos solicitados não possui lançamentos.",
          goalId: goal.goalId,
          scope: artifactScope,
          blocks: [
            {
              type: "metric",
              label: "Dados insuficientes",
              text: "Não foi possível comparar",
              detail: `Sem lançamentos em: ${names}. Nenhum total foi estimado.`,
              provenance: { transactionIds: [], documentIds: [] },
            },
          ],
          warnings: ["periodo_vazio"],
        },
        ctx,
      );
      await settleTask(
        {
          taskId: task.taskId,
          status: "needs_input",
          evidenceRefs: [],
          artifactRefs: [artifact.artifactId],
          warnings: ["periodo_vazio"],
          missingInputs: empty.map((period) => period.label),
        },
        ctx,
      );
      await updateGoalStatus(goal.goalId, "needs_input", ctx);
      return {
        artifactId: artifact.artifactId,
        artifactKind: "analysis_v3" as const,
        nextAction: "present_financial_artifact" as const,
        blockCount: artifact.blocks.length,
        warnings: artifact.warnings,
      };
    }

    const financialPeriods: FinancialPeriod[] = loaded.map((period) => ({
      id: period.id,
      label: period.label,
      transactions: period.transactions,
    }));
    const series = analyzeFinancialSeries(financialPeriods);
    const first = series.points[0]!;
    const last = series.points.at(-1)!;
    const edgeIds = [...new Set([...first.transactionIds, ...last.transactionIds])];
    const documentIds = [
      ...new Set(
        loaded.flatMap((period) => period.transactions.map((transaction) => transaction.sourceDocument)),
      ),
    ];
    const driverRows =
      series.drivers.length > 0
        ? series.drivers.slice(0, 20).map((driver) => ({
            label: categoryLabel(labels, driver.category),
            amount: driver.delta,
            share: driver.shareOfChange,
            detail: driver.delta > 0 ? "Aumentou" : driver.delta < 0 ? "Diminuiu" : "Estável",
            provenance: {
              transactionIds: driver.transactionIds,
              documentIds,
            },
          }))
        : [
            {
              label: "Sem gastos categorizáveis",
              amount: 0,
              detail: "Os períodos só possuem pagamentos, transferências ou créditos.",
              provenance: {
                transactionIds: loaded.flatMap((period) =>
                  period.transactions.map((transaction) => transaction.id),
                ),
                documentIds,
              },
            },
          ];

    const artifactInput = {
      kind: "timeline" as const,
      title: "Evolução dos gastos",
      summary: `${first.label} → ${last.label}. A série e os fatores de mudança foram calculados diretamente do razão.`,
      goalId: goal.goalId,
      scope: artifactScope,
      blocks: [
        {
          type: "metric" as const,
          label: "Variação no período",
          amount: series.totalDelta,
          detail: `${formatCents(first.value)} → ${formatCents(last.value)}`,
          provenance: { transactionIds: edgeIds, documentIds },
        },
        {
          type: "series" as const,
          title: "Gasto por período",
          points: series.points.map((point) => ({
            periodId: point.id,
            label: point.label,
            amount: point.value,
            provenance: {
              transactionIds: point.transactionIds,
              documentIds: loaded
                .find((period) => period.id === point.id)!.transactions.map(
                  (transaction) => transaction.sourceDocument,
                ),
            },
          })),
        },
        {
          type: "breakdown" as const,
          title: "O que explica a mudança",
          rows: driverRows,
        },
      ],
      warnings: [],
    };
    const validated = FinancialArtifactSchema.parse({
      ...artifactInput,
      artifactId: "pending",
      version: 1,
      createdAt: new Date().toISOString(),
    });
    const { artifactId: _artifactId, createdAt: _createdAt, ...publishable } = validated;
    const published = await publishArtifact(
      {
        ...publishable,
      },
      ctx,
    );
    await settleTask(
      {
        taskId: task.taskId,
        status: "complete",
        evidenceRefs: documentIds,
        artifactRefs: [published.artifactId],
        warnings: published.warnings,
        missingInputs: [],
      },
      ctx,
    );
    await updateGoalStatus(goal.goalId, "completed", ctx);

    return {
      artifactId: published.artifactId,
      artifactKind: "analysis_v3" as const,
      nextAction: "present_financial_artifact" as const,
      blockCount: published.blocks.length,
      warnings: published.warnings,
    };
  },
});
