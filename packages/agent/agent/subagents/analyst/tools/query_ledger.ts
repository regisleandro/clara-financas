import { CONFIDENCE, ENTRY_KINDS, formatCents, totalSpend } from "@clara-financas/ledger";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadCategoryLabels } from "../../../lib/categories";
import { monthRange } from "../../../lib/dates";
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
    month: optionalText().describe(
      "Calendar month, YYYY-MM. Shorthand for from/to covering the whole month. Remember an invoice CYCLE is not a calendar month — for 'nesta fatura' questions prefer batchId.",
    ),
    issuer: optionalText().describe(
      "Card issuer/operator name as the person says it (e.g. 'Nubank'). Accent- and case-insensitive; matches the issuer of the document each transaction came from. Use for 'quanto gastei no <cartão>'.",
    ),
    batchId: optionalText().describe(
      "Restrict to ONE invoice, by the batchId shown in the ledger state. Prefer this over guessing dates whenever the question is about a specific invoice or 'nesta fatura'. An invoice still awaiting approval is included and every row says which `status` it is in.",
    ),
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

    // Todo o recorte vai ao BANCO. Antes, só a data ia; o resto era filtrado em
    // memória depois de carregar o razão inteiro — e a busca por texto, sendo
    // `includes()`, exigia acerto exato de caixa e acentuação.
    // `month` é açúcar sobre from/to; datas explícitas ganham quando as duas
    // formas vierem juntas, porque são o recorte mais específico.
    const monthDates = input.month !== undefined ? monthRange(input.month) : undefined;

    const rows = await loadLedger(tenantId, {
      from: input.from ?? monthDates?.from,
      to: input.to ?? monthDates?.to,
      issuer: input.issuer,
      batchId: input.batchId,
      // Perguntar sobre UMA fatura inclui a que ainda espera decisão: é
      // justamente a que está em conferência. Fora desse recorte, rascunho
      // continua fora, para não virar fato numa soma.
      includeProposed: input.batchId !== undefined,
      ids: input.transactionIds,
      search: input.search,
      kinds: input.kinds,
      confidences: input.confidences,
      reviewed: input.reviewed,
      category: input.category,
      ...(input.uncategorizedOnly === true ? { hasCategory: false } : {}),
    });

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
    // Rascunho no resultado tem de ser dito, não deduzido: apresentar como
    // registrado o que ainda espera aprovação é o erro que a exclusão de
    // `proposed` tentava evitar. Aqui ele entra — mas anunciado.
    const draftCount = rows.filter((row) => row.status === "proposed").length;

    return {
      matched: rows.length,
      truncated,
      ...(draftCount > 0
        ? {
            draftCount,
            draftNote: `${draftCount} ${draftCount === 1 ? "lançamento pertence" : "lançamentos pertencem"} a uma fatura ainda em conferência, não ao razão confirmado. Diga isso na resposta.`,
          }
        : {}),
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
