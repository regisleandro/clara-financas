import { defineTool } from "eve/tools";
import { z } from "zod";

import { categoryInput } from "../lib/schema";

import { setInvoiceFocus } from "../lib/invoice-focus";
import { requireSessionCaller } from "../lib/tenant";
import { writeProposedBatch } from "../lib/write-proposed-batch";

/**
 * Grava um lote proposto como RASCUNHO e roda a conferência — pelo INPUT.
 *
 * Sem gate de aprovação, de propósito: um rascunho não é o razão. Nada
 * auditável foi tocado, e o trigger do banco só protege linhas já confirmadas.
 *
 * É esta separação que faz o cartão de conferência funcionar: "Corrigir" mexe
 * livremente no rascunho, e o gate incide uma vez só, sobre o estado final já
 * revisado — o que torna a decisão binária de aprovar honesta.
 *
 * Para o fluxo normal de upload, prefira `propose_batch_from_extraction`: o
 * extrator já persistiu a extração completa e esta transcrição manual das
 * linhas é exatamente o que a passagem por referência elimina. Esta tool fica
 * para lotes montados na conversa (poucas linhas ditadas pela pessoa) e para
 * repropor com correções que não vieram de extração.
 */
export default defineTool({
  description:
    "Records transactions as a draft batch and checks the sum against the declared total. For a document the extractor just processed, prefer propose_batch_from_extraction (by reference, no retyping). Use this one for batches assembled in conversation. Nothing enters the ledger here — only after the person approves.",
  inputSchema: z.object({
    documentId: z.string().min(1),
    documentKind: z
      .enum(["unknown", "credit_card_invoice", "bank_statement", "invoice_nfe"])
      .optional()
      .describe("Kind of document. Use bank_statement for account statements."),
    issuer: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Who issued the document, as printed on it — 'Nubank', 'Itaú'. Always fill this when the document identifies the issuer: it becomes the title of the verification card.",
      ),
    periodStart: z.string().nullable().optional(),
    periodEnd: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    declaredTotal: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe("Total declared in the document, IN CENTS. null when the document declares none."),
    declaredSubtotals: z
      .object({
        fees: z.number().int().nullable().optional(),
        purchases: z.number().int().nullable().optional(),
      })
      .nullable()
      .optional()
      .describe(
        'Subtotals from the invoice SUMMARY block, in cents: "IOF de compras internacionais" into `fees`, "Total de compras" into `purchases`. These are what make it possible to say WHERE a discrepancy is.',
      ),
    openingBalance: z.number().int().nullable().optional().describe("Opening bank-statement balance in cents."),
    closingBalance: z.number().int().nullable().optional().describe("Closing bank-statement balance in cents."),
    transactions: z.array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        originalDescription: z.string().min(1),
        merchant: z.string().nullable().optional(),
        amount: z
          .number()
          .int()
          .describe("IN CENTS, signed: expense > 0, credit (payment/refund) < 0."),
        kind: z
          .enum([
            "purchase",
            "payment",
            "refund",
            "fee",
            "adjustment",
            "income",
            "transfer",
            "card_payment",
            "cash_withdrawal",
          ])
          .optional(),
        installment: z
          .object({ current: z.number().int().positive(), total: z.number().int().positive() })
          .nullable()
          .optional(),
        category: categoryInput(),
        extractionConfidence: z.enum(["alta", "media", "baixa"]),
        page: z.number().int().positive().nullable().optional(),
      }),
    ),
    overwriteEditedDraft: z
      .boolean()
      .optional()
      .describe(
        "Pass true ONLY after the person confirmed discarding an already-corrected draft of this document. Without it, proposing over an edited draft is refused with rascunho_editado.",
      ),
  }),
  async execute(input, ctx) {
    const { tenantId, sessionId } = requireSessionCaller(ctx);

    const result = await writeProposedBatch(tenantId, input);
    if ("error" in result) return result;
    const focused = await setInvoiceFocus(tenantId, sessionId, result.batchId);
    if (!focused) {
      throw new Error("A sessão Eve não estava persistida para guardar o foco da fatura.");
    }

    return {
      batchId: result.batchId,
      status: "proposed" as const,
      documentKind: result.documentKind,
      // O emissor volta no retorno porque é dele que a tela tira o título do
      // cartão. Calculado aqui e não devolvido é o mesmo que não calculado.
      issuer: result.issuer,
      invoiceLabel: result.invoiceLabel,
      periodEnd: result.periodEnd,
      dueDate: result.dueDate,
      ...(input.openingBalance !== undefined ? { openingBalance: input.openingBalance } : {}),
      ...(input.closingBalance !== undefined ? { closingBalance: input.closingBalance } : {}),
      transactionCount: result.transactionCount,
      checksum: result.checksum,
      ...(result.statementBalance === undefined
        ? {}
        : { statementBalance: result.statementBalance }),
      ...(result.duplicateSuspects !== undefined
        ? {
            duplicateSuspects: result.duplicateSuspects,
            duplicateNote:
              "Linhas com mesma data, valor e comerciante já CONFIRMADAS vindas de outro documento — possível dupla contagem (fatura parcial + fechada). AVISE a pessoa antes de abrir o commit; ela decide com os ids em mãos.",
          }
        : {}),
      next: "If the verification looks good, call `commit_batch` to open the decision. Do not ask in prose whether you may record it.",
    };
  },
});
