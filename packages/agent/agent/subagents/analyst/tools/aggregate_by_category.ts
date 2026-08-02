import { formatCents, spendable, sumOf, type Countable } from "@clara-financas/ledger";
import { AnalysisScopeSchema } from "@clara-financas/views/agent-contracts";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { categoryLabel, loadCategoryLabels } from "../../../lib/categories";
import {
  canonicalAnalysisScope,
  draftNote,
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
        // Recorte vazio é uma resposta completa, com testemunha vazia: não há
        // lançamento para conferir, e é isso mesmo que o painel diz.
        [],
      );
    }

    const labels = await loadCategoryLabels(tenantId);
    const counted = spendable(ledger);

    /*
     * Bruto em tudo — topo e linhas na MESMA escala.
     *
     * A versão anterior somava compras brutas nas linhas e mostrava o gasto
     * líquido no topo. Cada número estava certo isoladamente, e o painel
     * mentia mesmo assim: somar as linhas na tela dava outro número que o
     * destaque logo acima delas (R$ 150,00 contra R$ 130,00 no caso que estava
     * coberto por teste). Quem confere uma fatura soma a coluna — e concluía,
     * com razão, que nenhum dos dois merecia confiança.
     *
     * Agora o destaque é COMPRAS, as linhas são compras, e elas fecham. O que
     * o líquido tinha de informação não se perde: créditos e líquido viajam no
     * detalhe, nomeados. Ver `figure.ts` para por que a fórmula viaja junto.
     *
     * Só os painéis analíticos usam bruto. A CONFERÊNCIA de fatura continua
     * líquida — ela compara com o total declarado no documento, e um estorno
     * reduz esse total de verdade.
     */
    const purchases = counted.filter((transaction) => transaction.amount > 0);
    const credits = counted.filter((transaction) => transaction.amount < 0);

    const grossTotal = sumOf(purchases);
    const creditTotal = sumOf(credits);
    const netTotal = sumOf(counted);

    const buckets = new Map<string | null, { purchases: Countable[]; credits: Countable[] }>();
    for (const transaction of counted) {
      const key = transaction.category ?? null;
      const bucket = buckets.get(key) ?? { purchases: [], credits: [] };
      (transaction.amount < 0 ? bucket.credits : bucket.purchases).push(transaction);
      buckets.set(key, bucket);
    }

    const porCategoria = [...buckets.entries()]
      .map(([category, bucket]) => ({
        label: categoryLabel(labels, category),
        gross: sumOf(bucket.purchases),
        credits: sumOf(bucket.credits),
      }))
      .sort((left, right) => right.gross.value - left.gross.value);

    /*
     * Barra é COMPRA. Uma categoria que no período só teve estorno não tem
     * barra — e isso é uma decisão, não um esquecimento.
     *
     * A versão anterior a desenhava como uma linha de R$ 0,00: tecnicamente
     * visível, informativamente nada, e com o crédito abatendo o topo sem
     * aparecer em lugar nenhum. Dar-lhe o valor do crédito quebraria a soma das
     * linhas; dar-lhe zero com os ids do estorno seria um valor que os próprios
     * lançamentos desmentem. As duas saídas erradas se parecem com honestidade
     * e não são.
     *
     * O que ela teve fica dito por extenso no resumo, com o valor.
     */
    const soComCredito = porCategoria.filter(
      (entry) => entry.gross.value === 0 && entry.credits.value !== 0,
    );
    const rows = porCategoria
      .filter((entry) => entry.gross.value > 0)
      .map((entry) => ({
        label: entry.label,
        amount: entry.gross.value,
        detail:
          entry.credits.value === 0
            ? `Compras ${formatCents(entry.gross.value)}`
            : `Compras ${formatCents(entry.gross.value)} · créditos ${formatCents(entry.credits.value)}`,
        ...(grossTotal.value > 0 ? { share: entry.gross.value / grossTotal.value } : {}),
        // A proveniência da LINHA acompanha o valor da linha: só as compras.
        // Antes ela carregava também os créditos daquela categoria, então abrir
        // a origem de "R$ 100,00" listava lançamentos que somavam R$ 80,00.
        transactionIds: entry.gross.transactionIds,
      }));

    const notaDeCreditos =
      soComCredito.length === 0
        ? ""
        : ` ${soComCredito
            .map((entry) => `${entry.label} teve apenas créditos (${formatCents(entry.credits.value)})`)
            .join("; ")}.`;

    // Um recorte só de créditos não tem composição de compras para desenhar.
    // `breakdown` exige ao menos uma linha, e forçar uma seria inventar barra.
    if (rows.length === 0) {
      return saveAnalysis(
        {
          kind: "metric",
          title: "Composição dos gastos",
          summary: `${label} não teve compras.${notaDeCreditos}${draftNote(ledger)}`,
          metric: {
            label: "Compras no período",
            amount: 0,
            detail: `créditos ${formatCents(creditTotal.value)} · líquido ${formatCents(netTotal.value)}`,
            transactionIds: [],
          },
          rows: [],
        },
        scope,
        ctx,
        counted,
      );
    }

    return saveAnalysis(
      {
        kind: "breakdown",
        title: "Composição dos gastos",
        summary:
          creditTotal.value === 0
            ? `${label}. As barras representam compras; as linhas somam o total.${draftNote(ledger)}`
            : `${label}. As barras representam compras; os créditos do período estão no topo.${notaDeCreditos}${draftNote(ledger)}`,
        metric: {
          label: "Compras no período",
          amount: grossTotal.value,
          detail:
            creditTotal.value === 0
              ? label
              : `${label} · créditos ${formatCents(creditTotal.value)} · líquido ${formatCents(netTotal.value)}`,
          transactionIds: grossTotal.transactionIds,
        },
        rows,
      },
      scope,
      ctx,
      counted,
    );
  },
});
