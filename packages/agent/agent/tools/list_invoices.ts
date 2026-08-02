import { getDb } from "@clara-financas/db";
import { batches, documents, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { formatCents, formatDocumentLabel } from "@clara-financas/ledger";
import { eq, inArray, sql } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireTenantCaller } from "../lib/tenant";
import { latestInvoiceOrder, oldestInvoiceOrder } from "@clara-financas/db/invoice-order";

/**
 * Recuperação explícita para o histórico que não cabe no snapshot de turno.
 * O snapshot mantém o contexto barato; esta tool abre o histórico sob demanda.
 *
 * Devolve os DOIS totais de cada fatura, e a razão é que um deles falta com
 * frequência: `declaredTotalCents` é o que o documento afirma, e é `null` quando
 * ele não afirma nada. Só com ele, "liste as faturas mês a mês" produzia linhas
 * sem valor nenhum — a coordenadora não pode somar, então não tinha o que
 * apresentar. `extractedTotalCents` é a soma que a extração leu daquela fatura,
 * calculada aqui em SQL, com a mesma regra do domínio: pagamento de fatura não
 * compõe o total (`countsTowardDeclaredTotal`), porque quita o ciclo anterior.
 */
export default defineTool({
  description:
    "Lists financial documents already sent by this person (invoices, bank statements and notes), newest first, each with its cycle, due date, entry count and BOTH totals — what the document declares (may be null) and what the extraction summed from it. Use for document history, 'quais faturas eu tenho', 'as faturas mês a mês', or when the document asked about is older than the ledger snapshot. Present it with the `invoices` panel, copying the values from here.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).optional().describe("Defaults to 20."),
    oldestFirst: z
      .boolean()
      .optional()
      .describe(
        "Order from the oldest cycle to the newest. Use for a month-by-month reading, where the sequence is the point.",
      ),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    return forTenant(
      tenantId,
      async (tx) => {
        const rows = await tx
          .select({
            batchId: batches.id,
            documentId: batches.documentId,
            issuer: documents.issuer,
            documentKind: documents.kind,
            status: batches.status,
            periodStart: batches.periodStart,
            periodEnd: batches.periodEnd,
            dueDate: batches.dueDate,
            declaredTotalCents: batches.declaredTotal,
            checksumResult: batches.checksumResult,
            transactionCount: sql<number>`(
              select count(*)::int from ${transactions}
              where ${transactions.batchId} = ${batches.id}
            )`,
            // A soma que a extração leu — a mesma regra de
            // `countsTowardDeclaredTotal`: tudo menos o pagamento da fatura,
            // que quita o ciclo anterior e não compõe este total.
            extractedTotalCents: sql<number>`(
              select coalesce(sum(${transactions.amount}), 0)::int from ${transactions}
              where ${transactions.batchId} = ${batches.id}
                and ${transactions.kind} <> 'payment'
            )`,
          })
          .from(batches)
          .innerJoin(documents, eq(documents.id, batches.documentId))
          .where(inArray(batches.status, ["proposed", "confirmed"]))
          // As duas direções saem da MESMA definição de ordem (ver
          // `invoice-order.ts`): escrever o `desc` à mão aqui foi como as três
          // ordenações divergentes nasceram da primeira vez.
          .orderBy(...(input.oldestFirst === true ? oldestInvoiceOrder() : latestInvoiceOrder()))
          .limit(input.limit ?? 20);

        return rows.map((row) => ({
          ...row,
          documentLabel: formatDocumentLabel(row),
          // Alias preservado para o contrato legado da coordenadora. Continua
          // sendo `formatDocumentLabel`: chamar um extrato de "fatura" no
          // rótulo é o defeito que esse formatador existe para não cometer.
          invoiceLabel: formatDocumentLabel(row),
          declaredTotalFormatted:
            row.declaredTotalCents === null ? null : formatCents(row.declaredTotalCents),
          extractedTotalFormatted: formatCents(row.extractedTotalCents),
          // Dito por linha, para o painel não precisar deduzir: quando o
          // documento não declara total, o valor que a pessoa lê é o extraído.
          totalToShow: row.declaredTotalCents ?? row.extractedTotalCents,
        }));
      },
      getDb(),
    );
  },
});
