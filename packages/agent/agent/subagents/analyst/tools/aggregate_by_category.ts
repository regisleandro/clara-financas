import { formatCents, spendable, totalSpend } from "@clara-financas/ledger";
import { AnalysisScopeSchema } from "@clara-financas/views/agent-contracts";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { categoryLabel, loadCategoryLabels } from "../../../lib/categories";
import {
  canonicalAnalysisScope,
  scopeFilter,
  scopeLabel,
} from "../../../lib/analysis-scope";
import { requireTenantCaller } from "../../../lib/tenant";
import { ledgerCoverage, loadLedger } from "../../../lib/ledger-query";
import { saveAnalysis } from "../lib/save-analysis";

/**
 * Composição do gasto por categoria.
 *
 * Devolve `transactionIds` em cada linha — é isso que faz a proveniência ser
 * estrutural, e não uma citação que o modelo pode esquecer de fazer.
 */
export default defineTool({
  description:
    "Sums spending by category over a period. Use for 'quanto gastei', 'com o quê', 'qual categoria pesa mais'.",
  inputSchema: z.object({ scope: AnalysisScopeSchema }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const scope = canonicalAnalysisScope(input.scope);
    const ledger = await loadLedger(tenantId, scopeFilter(scope));
    const label = scopeLabel(scope);

    if (ledger.length === 0) {
      const coverage = await ledgerCoverage(tenantId);
      const detail =
        coverage.count === 0
          ? "O razão ainda não tem lançamentos confirmados."
          : `O razão possui dados de ${coverage.firstDate} a ${coverage.lastDate}, mas não neste recorte.`;
      return saveAnalysis(
        {
          kind: "metric",
          title: "Gastos no período",
          summary: `O recorte ${label} não possui lançamentos.`,
          metric: { label: "Resultado", text: "Sem lançamentos", detail, transactionIds: [] },
          rows: [],
        },
        scope,
        ctx,
      );
    }

    const total = totalSpend(ledger);
    const labels = await loadCategoryLabels(tenantId);
    const buckets = new Map<
      string | null,
      { gross: number; credits: number; net: number; transactionIds: string[] }
    >();
    for (const transaction of spendable(ledger)) {
      const key = transaction.category ?? null;
      const bucket = buckets.get(key) ?? { gross: 0, credits: 0, net: 0, transactionIds: [] };
      bucket.net += transaction.amount;
      if (transaction.amount > 0) bucket.gross += transaction.amount;
      if (transaction.amount < 0) bucket.credits += transaction.amount;
      bucket.transactionIds.push(transaction.id);
      buckets.set(key, bucket);
    }
    const grossTotal = [...buckets.values()].reduce((sum, bucket) => sum + bucket.gross, 0);
    const rows = [...buckets.entries()]
      .sort(([, left], [, right]) => right.gross - left.gross || right.net - left.net)
      .map(([category, bucket]) => ({
        label: categoryLabel(labels, category),
        // A barra e o valor da linha representam compras BRUTAS. O topo é o
        // gasto líquido; misturar líquido por categoria com share bruto faria
        // a mesma linha mostrar duas escalas incompatíveis.
        amount: bucket.gross,
        detail:
          bucket.credits === 0
            ? `Compras ${formatCents(bucket.gross)}`
            : `Créditos ${formatCents(bucket.credits)} · líquido ${formatCents(bucket.net)}`,
        ...(bucket.gross > 0 && grossTotal > 0 ? { share: bucket.gross / grossTotal } : {}),
        transactionIds: bucket.transactionIds,
      }));

    return saveAnalysis(
      {
        kind: "breakdown",
        title: "Composição dos gastos",
        summary: `${label}. As barras representam compras brutas; créditos aparecem no detalhe.`,
        metric: {
          label: "Gasto líquido",
          amount: total.value,
          detail: label,
          transactionIds: total.transactionIds,
        },
        rows,
      },
      scope,
      ctx,
    );
  },
});
