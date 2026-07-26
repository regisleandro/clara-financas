import type { Database } from "@clara-financas/db";
import { batches, transactions } from "@clara-financas/db/schema/ledger";
import { verifyChecksum, type ChecksumReport } from "@clara-financas/ledger";
import { and, eq } from "drizzle-orm";

/**
 * Reconfere um lote contra o total declarado e PERSISTE o resultado.
 *
 * Era um bloco duplicável dentro de `edit_proposed_batch` — e a duplicação que
 * não aconteceu virou bug: `create_adjustment` corrigia a linha e não tocava no
 * lote, então `checksumResult: mismatch` ficava gravado para sempre. A fatura
 * já ajustada continuava listada como divergente na tela de revisão, escolhida
 * como abertura de conversa pelos starters, e descrita ao modelo como
 * "divergência ainda aberta" no snapshot — a Clara reafirmava um problema que
 * a pessoa acabara de resolver.
 *
 * Qualquer escrita que mude a soma de um lote (edição de rascunho, linha de
 * ajuste) chama isto antes de retornar, dentro da MESMA transação.
 */
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function recomputeBatchChecksum(
  tx: Tx,
  tenantId: string,
  batch: typeof batches.$inferSelect,
): Promise<{ checksum: ChecksumReport; transactionCount: number }> {
  const rows = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.batchId, batch.id), eq(transactions.tenantId, tenantId)));

  const checksum = verifyChecksum({
    documentId: batch.documentId,
    issuer: null,
    periodStart: batch.periodStart,
    periodEnd: batch.periodEnd,
    dueDate: batch.dueDate,
    declaredTotal: batch.declaredTotal,
    // Persistidos no lote: sem eles, reconferir após uma correção perderia a
    // localização e voltaria a dizer só "não bate".
    declaredSubtotals: batch.declaredSubtotals ?? null,
    transactions: rows.map((row) => ({
      id: row.id,
      date: row.date,
      originalDescription: row.originalDescription,
      merchant: row.merchant,
      merchantKey: row.merchantKey,
      amount: row.amount,
      kind: row.kind,
      installment:
        row.installmentCurrent !== null && row.installmentTotal !== null
          ? { current: row.installmentCurrent, total: row.installmentTotal }
          : null,
      category: row.category,
      extractionConfidence: row.extractionConfidence,
      sourceDocument: row.sourceDocumentId,
      page: row.page,
    })),
  });

  await tx
    .update(batches)
    .set({
      extractedTotal: checksum.extractedTotal,
      checksumResult: checksum.result,
      checksumReport: checksum,
    })
    .where(eq(batches.id, batch.id));

  return { checksum, transactionCount: rows.length };
}
