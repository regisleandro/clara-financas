import { formatCents, totalSpend } from "@clara-financas/ledger";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadCategoryLabels } from "../../../lib/categories";
import { requireTenantCaller } from "../../../lib/tenant";
import { optionalText } from "../../../lib/schema";
import { brief, ledgerCoverage, loadLedger } from "../../../lib/ledger-query";

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
    transactionIds: z
      .array(z.string())
      .optional()
      .describe("Ids returned by another analysis. Use to drill into a number."),
    from: optionalText().describe("Start date, YYYY-MM-DD."),
    to: optionalText().describe("End date, YYYY-MM-DD, inclusive."),
    batchId: optionalText().describe(
      "Restrict to ONE invoice, by the batchId shown in the ledger state. Prefer this over guessing dates whenever the question is about a specific invoice or 'nesta fatura'.",
    ),
    search: optionalText().describe("Text to match in the description or the merchant."),
    category: optionalText().describe("Filter by category identifier."),
    uncategorizedOnly: z
      .boolean()
      .optional()
      .describe("Only transactions that still have no category."),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);

    // O filtro por data vai ao banco; o resto é em memória, porque o volume de
    // um razão pessoal cabe folgadamente e evita montar SQL dinâmico aqui.
    let rows = await loadLedger(tenantId, {
      from: input.from,
      to: input.to,
      batchId: input.batchId,
    });

    if (input.transactionIds !== undefined && input.transactionIds.length > 0) {
      const wanted = new Set(input.transactionIds);
      rows = rows.filter((row) => wanted.has(row.id));
    }
    if (input.category !== undefined) {
      rows = rows.filter((row) => row.category === input.category);
    }
    if (input.uncategorizedOnly === true) {
      rows = rows.filter((row) => row.category === null);
    }
    if (input.search !== undefined) {
      const needle = input.search.toLowerCase();
      rows = rows.filter(
        (row) =>
          row.originalDescription.toLowerCase().includes(needle) ||
          (row.merchant ?? "").toLowerCase().includes(needle),
      );
    }

    if (rows.length === 0) {
      return {
        matched: 0,
        empty: true as const,
        // O vazio é ambíguo: razão sem dados, ou recorte que errou o alvo? A
        // cobertura deixa o modelo distinguir em vez de concluir "não há nada
        // registrado" e mandar reenviar um documento que já está lá.
        ledgerCoverage: await ledgerCoverage(tenantId),
        message:
          "No transactions matched this slice. Check the dates or batchId against the ledger coverage before concluding nothing is recorded.",
      };
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

    return {
      matched: rows.length,
      truncated,
      // Dizer que truncou importa: sem isso o modelo apresentaria um recorte
      // parcial como se fosse o conjunto inteiro.
      note: truncated ? `Mostrando as ${LIMIT} primeiras de ${rows.length}.` : undefined,
      totals: {
        spendCents: spend.value,
        spendFormatted: formatCents(spend.value),
        ...(paymentsCents !== 0
          ? {
              paymentsCents,
              paymentsFormatted: formatCents(paymentsCents),
              sumNote:
                "spendCents considera apenas gastos; pagamentos de fatura estão em paymentsCents, fora da soma de gasto. Sinal segue o razão: crédito/pagamento é negativo.",
            }
          : {}),
      },
      transactions: rows.slice(0, LIMIT).map((row) => brief(row, labels)),
    };
  },
});
