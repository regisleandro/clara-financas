import { CONFIDENCE, ENTRY_KINDS, totalSpend } from "@clara-financas/ledger";
import { AnalysisScopeSchema } from "@clara-financas/views/agent-contracts";
import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  canonicalAnalysisScope,
  scopeFilter,
  scopeLabel,
} from "../../../lib/analysis-scope";
import { loadCategoryLabels } from "../../../lib/categories";
import { requireTenantCaller } from "../../../lib/tenant";
import { optionalText } from "../../../lib/schema";
import { brief, ledgerCoverage, loadLedger } from "../../../lib/ledger-query";
import { saveAnalysis } from "../lib/save-analysis";

/**
 * Consulta de transações específicas.
 *
 * É a tool que responde "de onde veio esse valor": recebe os ids que outra
 * análise devolveu e mostra as linhas por trás do número.
 */
const LIMIT = 100;

export default defineTool({
  description:
    "Lists ledger transactions by period, text, or ids. Use to show where a number came from, or to answer questions about specific entries.",
  inputSchema: z.object({
    scope: AnalysisScopeSchema.optional().describe("Defaults to the whole confirmed ledger."),
    transactionIds: z
      .array(z.string())
      .optional()
      .describe("Ids returned by another analysis. Use to drill into a number."),
    search: optionalText().describe(
      "Words to look for in the raw description or the merchant. Accent- and case-insensitive, and ANY word matching brings the row — use it for 'descrição parecida com X'.",
    ),
    category: optionalText().describe("Filter by category identifier."),
    uncategorizedOnly: z
      .boolean()
      .optional()
      .describe("Only transactions that still have no category."),
    kinds: z
      .array(z.enum(ENTRY_KINDS))
      .optional()
      .describe(
        "Nature of the entry. `payment` is the invoice payment itself, which does NOT count toward the invoice total.",
      ),
    confidences: z
      .array(z.enum(CONFIDENCE))
      .optional()
      .describe("Extraction confidence. Use `baixa` to find what was read with doubt."),
    reviewed: z
      .boolean()
      .optional()
      .describe("true = only what a person already reviewed; false = only what is still pending."),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const scope = canonicalAnalysisScope(input.scope ?? ({ kind: "all" } as const));

    // Todo o recorte vai ao BANCO. Antes, só a data ia; o resto era filtrado em
    // memória depois de carregar o razão inteiro — e a busca por texto, sendo
    // `includes()`, exigia acerto exato de caixa e acentuação.
    // `month` é açúcar sobre from/to; datas explícitas ganham quando as duas
    // formas vierem juntas, porque são o recorte mais específico.
    const rows = await loadLedger(tenantId, {
      ...scopeFilter(scope),
      // Perguntar sobre UMA fatura inclui a que ainda espera decisão: é
      // justamente a que está em conferência. Fora desse recorte, rascunho
      // continua fora, para não virar fato numa soma.
      includeProposed: scope.kind === "invoice",
      ids: input.transactionIds,
      search: input.search,
      kinds: input.kinds,
      confidences: input.confidences,
      reviewed: input.reviewed,
      category: input.category,
      ...(input.uncategorizedOnly === true ? { hasCategory: false } : {}),
    });

    if (rows.length === 0) {
      const coverage = await ledgerCoverage(tenantId);
      return saveAnalysis(
        {
          kind: "metric",
          title: "Lançamentos",
          summary: `Nenhum lançamento corresponde a ${scopeLabel(scope)} e aos filtros informados.`,
          metric: {
            label: "Resultado",
            text: "Sem lançamentos",
            detail:
              coverage.count === 0
                ? "O razão ainda não possui lançamentos confirmados."
                : `A cobertura disponível vai de ${coverage.firstDate} a ${coverage.lastDate}.`,
            transactionIds: [],
          },
          rows: [],
        },
        scope,
        ctx,
      );
    }

    // `totalSpend` soma só GASTO (`countsTowardDeclaredTotal`): pagamento de
    // fatura fica de fora. Sem dizer isso, "quanto paguei de fatura?" voltava
    // `total: R$ 0,00` com 3 linhas de pagamento na lista — e o modelo
    // repassava o zero como fato.
    const spend = totalSpend(rows);
    const paymentsCents = rows
      .filter((row) => row.kind === "payment")
      .reduce((sum, row) => sum + row.amount, 0);
    const truncated = rows.length > LIMIT;
    const labels = await loadCategoryLabels(tenantId);
    // Rascunho no resultado tem de ser dito, não deduzido: apresentar como
    // registrado o que ainda espera aprovação é o erro que a exclusão de
    // `proposed` tentava evitar. Aqui ele entra — mas anunciado.
    const draftCount = rows.filter((row) => row.status === "proposed").length;

    const onlyPayments = rows.every((row) => row.kind === "payment");
    const metricIds = onlyPayments
      ? rows.map((row) => row.id)
      : spend.transactionIds;
    const summarized = rows.slice(0, LIMIT).map((row) => brief(row, labels));
    return saveAnalysis(
      {
        kind: "transactions",
        title: "Lançamentos",
        summary: `${rows.length} ${rows.length === 1 ? "lançamento encontrado" : "lançamentos encontrados"} em ${scopeLabel(scope)}.${truncated ? ` Exibindo os primeiros ${LIMIT}.` : ""}${draftCount > 0 ? ` ${draftCount} ainda em conferência.` : ""}`,
        metric: {
          label: onlyPayments ? "Pagamentos de fatura" : "Gastos do recorte",
          amount: onlyPayments ? paymentsCents : spend.value,
          detail: onlyPayments ? "Pagamentos não contam como gasto." : scopeLabel(scope),
          transactionIds: metricIds,
        },
        rows: summarized.map((row) => ({
          label: row.merchant ?? row.description,
          amount: row.amountCents,
          detail: `${row.date} · ${row.kind} · ${row.categoryLabel} · confiança ${row.confidence}${row.status === "proposed" ? " · em conferência" : ""}`,
          transactionIds: [row.id],
        })),
      },
      scope,
      ctx,
    );
  },
});
