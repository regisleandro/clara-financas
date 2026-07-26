import { getDb } from "@clara-financas/db";
import { batches, documents, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import {
  formatCents,
  formatInvoiceLabel,
  type ChecksumReport,
} from "@clara-financas/ledger";
import { and, asc, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { categoryLabel, loadCategoryLabels } from "../lib/categories";
import { notFound } from "../lib/errors";
import { setInvoiceFocus } from "../lib/invoice-focus";
import { requireSessionCaller } from "../lib/tenant";

/**
 * Abrir uma fatura e ver o que está dentro dela.
 *
 * Esta tool faltava, e a falta fechava o caminho inteiro da correção. Para
 * consertar um item a Clara precisa do `transactionId` — e nenhuma leitura
 * devolvia os itens de um lote: `list_invoices` só traz agregados, as tools do
 * analista ignoravam rascunho, e os ids que `propose_batch` devolve vivem
 * apenas naquele turno, dentro de `checksum.suspectItems` (no máximo dez). Se o
 * contexto compactou, sumiram — e com eles a possibilidade de agir.
 *
 * Junto vem o `checksumReport` PERSISTIDO. Ele é gravado desde sempre em
 * `batches.checksum_report` e nunca era lido de volta: a divergência de ontem
 * era irrecuperável hoje, restando ao modelo o `checksumResult` como palavra
 * solta ("mismatch") — sem valor, sem diferença, sem suspeitos.
 */
export default defineTool({
  description:
    "Opens ONE invoice and returns its entries plus the stored verification report. Call this before fixing anything in an invoice: the entry ids you need for edit_proposed_batch or create_adjustment come from here. Works for drafts and for already recorded invoices.",
  inputSchema: z.object({
    batchId: z.string().min(1).describe("Batch id, as shown in the ledger state."),
    onlySuspects: z
      .boolean()
      .optional()
      .describe(
        "Only the entries the verification flagged as likely causes of the difference. Use when the invoice is large and the question is about the divergence.",
      ),
  }),
  async execute(input, ctx) {
    const { tenantId, sessionId } = requireSessionCaller(ctx);

    const found = await forTenant(
      tenantId,
      async (tx) => {
        const [batch] = await tx
          .select({
            batchId: batches.id,
            documentId: batches.documentId,
            status: batches.status,
            periodStart: batches.periodStart,
            periodEnd: batches.periodEnd,
            dueDate: batches.dueDate,
            declaredTotal: batches.declaredTotal,
            declaredSubtotals: batches.declaredSubtotals,
            extractedTotal: batches.extractedTotal,
            checksumResult: batches.checksumResult,
            checksumReport: batches.checksumReport,
            issuer: documents.issuer,
          })
          .from(batches)
          .innerJoin(documents, eq(documents.id, batches.documentId))
          .where(and(eq(batches.tenantId, tenantId), eq(batches.id, input.batchId)))
          .limit(1);

        if (batch === undefined) return null;

        const rows = await tx
          .select()
          .from(transactions)
          .where(and(eq(transactions.tenantId, tenantId), eq(transactions.batchId, batch.batchId)))
          .orderBy(asc(transactions.date), asc(transactions.id));

        return { batch, rows };
      },
      getDb(),
    );

    if (found === null) {
      return notFound("lote_nao_encontrado", `Nenhuma fatura com o id ${input.batchId}.`, {
        hint: "Confira os batchId do estado do razão, ou chame list_invoices para o histórico.",
      });
    }

    const { batch, rows } = found;
    const focused = await setInvoiceFocus(tenantId, sessionId, batch.batchId);
    if (!focused) {
      throw new Error("A sessão Eve não estava persistida para guardar o foco da fatura.");
    }
    const report = batch.checksumReport as ChecksumReport | null;
    const suspects = new Set((report?.suspectItems ?? []).map((item) => item.transactionId));
    const labels = await loadCategoryLabels(tenantId);

    const selected = input.onlySuspects === true ? rows.filter((row) => suspects.has(row.id)) : rows;

    return {
      batchId: batch.batchId,
      documentId: batch.documentId,
      invoiceLabel: formatInvoiceLabel(batch),
      issuer: batch.issuer,
      // O estado decide o que é possível fazer, então ele vem primeiro e
      // explicado: rascunho se corrige com edit_proposed_batch; registrado
      // exige uma linha de ajuste.
      status: batch.status,
      editable: batch.status === "proposed",
      period: { start: batch.periodStart, end: batch.periodEnd, dueDate: batch.dueDate },
      declaredTotalCents: batch.declaredTotal,
      declaredSubtotals: batch.declaredSubtotals,
      extractedTotalCents: batch.extractedTotal,
      checksum:
        report === null
          ? { result: batch.checksumResult }
          : {
              result: report.result,
              likelyCause: report.likelyCause,
              localizedIn: report.localizedIn,
              declaredTotalCents: report.declaredTotal,
              extractedTotalCents: report.extractedTotal,
              differenceCents: report.difference,
              differenceFormatted:
                report.difference === null ? null : formatCents(report.difference),
              requiredAdjustmentCents:
                report.difference === null ? null : -report.difference,
              requiredAdjustmentFormatted:
                report.difference === null ? null : formatCents(-report.difference),
              suspectItems: report.suspectItems,
            },
      transactionCount: rows.length,
      returned: selected.length,
      transactions: selected.map((row) => ({
        id: row.id,
        date: row.date,
        description: row.originalDescription,
        merchant: row.merchant,
        amountCents: row.amount,
        amountFormatted: formatCents(row.amount),
        kind: row.kind,
        category: row.category,
        categoryLabel: categoryLabel(labels, row.category),
        confidence: row.extractionConfidence,
        installment:
          row.installmentCurrent !== null && row.installmentTotal !== null
            ? { current: row.installmentCurrent, total: row.installmentTotal }
            : null,
        page: row.page,
        suspect: suspects.has(row.id),
      })),
    };
  },
});
