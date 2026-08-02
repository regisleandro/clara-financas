import { detectRecurrences, formatCents } from "@clara-financas/ledger";
import { AnalysisScopeSchema } from "@clara-financas/views/agent-contracts";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadMerchantAliases } from "../../../lib/aliases";
import {
  canonicalAnalysisScope,
  draftNote,
  scopeFilter,
  scopeLabel,
} from "../../../lib/analysis-scope";
import { requireTenantCaller } from "../../../lib/tenant";
import { loadLedger } from "../../../lib/ledger-query";
import { saveAnalysis } from "../lib/save-analysis";

/**
 * Cobranças recorrentes.
 *
 * O critério é intervalo regular, não valor igual — assinatura que reajustou
 * continua sendo assinatura, e é justamente a mais interessante de apontar.
 * `priceChangePercent` é o que sustenta "subiu 43% e você quase não usa".
 */
export default defineTool({
  description:
    "Finds charges that repeat monthly at the same merchant, with annualised cost and price drift since the first charge. Use for 'assinaturas', 'cobranças repetidas', 'onde posso economizar'.",
  inputSchema: z.object({
    scope: AnalysisScopeSchema.optional().describe("Defaults to the whole confirmed ledger."),
    minOccurrences: z
      .number()
      .int()
      .min(2)
      .max(24)
      .optional()
      .describe(
        "Minimum number of charges to count as a recurrence. Defaults to 2, which surfaces likely patterns from only two invoices; each result carries `confirmed` so you can say which are certain. Raise to 3 to see only confirmed ones.",
      ),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const scope = canonicalAnalysisScope(input.scope ?? ({ kind: "all" } as const));
    const [ledger, merchantAliases] = await Promise.all([
      loadLedger(tenantId, scopeFilter(scope)),
      // Apelidos aprovados entram no agrupamento. Sem esta linha o conceito
      // MerchantAlias seria gravável e inerte.
      loadMerchantAliases(tenantId),
    ]);

    // Sem `?? 3`: o default do domínio é 2, e repeti-lo aqui com outro valor
    // era o que mantinha a análise muda para quem tem duas faturas.
    const recurrences = detectRecurrences(
      ledger,
      input.minOccurrences === undefined
        ? { merchantAliases }
        : { minOccurrences: input.minOccurrences, merchantAliases },
    );

    if (recurrences.length === 0) {
      return saveAnalysis(
        {
          kind: "metric",
          title: "Cobranças recorrentes",
          summary: `Nenhum padrão repetido foi encontrado em ${scopeLabel(scope)}.`,
          metric: {
            label: "Resultado",
            text: "Nenhuma recorrência identificada",
            detail: "São necessárias pelo menos duas cobranças em intervalos semelhantes.",
            transactionIds: [],
          },
          rows: [],
        },
        scope,
        ctx,
        [],
      );
    }

    return saveAnalysis(
      {
        kind: "recurrences",
        title: "Cobranças recorrentes",
        summary: `${recurrences.length} ${recurrences.length === 1 ? "padrão encontrado" : "padrões encontrados"} em ${scopeLabel(scope)}.${draftNote(ledger)}`,
        rows: recurrences.map((recurrence) => ({
          label: recurrence.merchant,
          amount: recurrence.annualizedCents,
          detail: `${recurrence.confirmed ? "Padrão confirmado" : "Padrão provável"} · ${recurrence.occurrences} ocorrências · última ${formatCents(recurrence.latestAmount)}`,
          transactionIds: recurrence.transactionIds,
        })),
      },
      scope,
      ctx,
      // O valor de cada linha é o custo ANUALIZADO — uma projeção a partir das
      // cobranças reais, não a soma delas. A testemunha serve para conferir que
      // a proveniência é real; a álgebra da projeção só fica verificável quando
      // `basis` viajar no painel (ver `@clara-financas/ledger/figure`).
      ledger,
    );
  },
});
