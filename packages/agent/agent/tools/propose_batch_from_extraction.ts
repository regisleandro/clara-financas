import { getDb } from "@clara-financas/db";
import { extractionStagings } from "@clara-financas/db/schema/extraction-staging";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { ExtractionResultSchema } from "@clara-financas/views/agent-contracts";
import { and, desc, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { notFound } from "../lib/errors";
import { setInvoiceFocus } from "../lib/invoice-focus";
import { optionalText } from "../lib/schema";
import { requireSessionCaller } from "../lib/tenant";
import { writeProposedBatch } from "../lib/write-proposed-batch";

/**
 * Propõe o lote a partir da extração PERSISTIDA — a passagem por referência.
 *
 * O extrator guarda a leitura completa na staging e devolve só um recibo; esta
 * tool consome a staging pelo `extractionId` e monta o rascunho sem que uma
 * única linha passe pelo contexto do coordenador. Antes, cada transação era
 * retranscrita token a token no input de `propose_batch` — custo de contexto
 * proporcional ao tamanho da fatura e risco de erro de cópia no elo mais
 * crítico do produto.
 *
 * A staging consumida é apagada na MESMA transação da leitura: o rascunho em
 * `batches`/`transactions` passa a ser a única fonte, e refazer a proposta
 * exige refazer a extração — que é o comportamento honesto quando a leitura
 * precisa mudar.
 */
export default defineTool({
  description:
    "Creates the draft batch from an extraction the extractor already persisted, by reference — no retyping. Pass the extractionId from the extractor's receipt (or just the documentId to use its latest extraction). Runs the checksum like propose_batch. Use right after the extractor returns.",
  inputSchema: z
    .object({
      extractionId: optionalText().describe("The id from the extractor's receipt. Preferred."),
      documentId: optionalText().describe(
        "Fallback: use the LATEST extraction of this document, when the receipt is no longer in context.",
      ),
      overwriteEditedDraft: z
        .boolean()
        .optional()
        .describe(
          "Pass true ONLY after the person confirmed discarding an already-corrected draft of this document. Without it, proposing over an edited draft is refused with rascunho_editado.",
        ),
    })
    .refine((input) => input.extractionId !== undefined || input.documentId !== undefined, {
      message: "informe extractionId ou documentId",
  }),
  async execute(input, ctx) {
    const { tenantId, sessionId } = requireSessionCaller(ctx);
    const db = getDb();

    const staged = await forTenant(
      tenantId,
      async (tx) => {
        const conditions = [eq(extractionStagings.tenantId, tenantId)];
        if (input.extractionId !== undefined) {
          conditions.push(eq(extractionStagings.id, input.extractionId));
        }
        if (input.documentId !== undefined) {
          conditions.push(eq(extractionStagings.documentId, input.documentId));
        }

        const [row] = await tx
          .select()
          .from(extractionStagings)
          .where(and(...conditions))
          .orderBy(desc(extractionStagings.createdAt))
          .limit(1);

        return row;
      },
      db,
    );

    if (staged === undefined) {
      return notFound(
        "extracao_nao_encontrada",
        "Nenhuma extração guardada para esse recorte.",
        {
          hint: "A staging é consumida pela proposta e substituída por leituras novas. Delegue o documento ao extrator de novo e use o extractionId do recibo.",
        },
      );
    }

    // A staging entrou pelo schema, mas revalidar aqui é o que garante que o
    // formato do razão nunca depende do que estava gravado num jsonb.
    const payload = ExtractionResultSchema.parse(staged.payload);

    const result = await writeProposedBatch(tenantId, {
      documentId: payload.documentId,
      issuer: payload.issuer,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      dueDate: payload.dueDate,
      declaredTotal: payload.declaredTotal,
      declaredSubtotals: payload.declaredSubtotals,
      transactions: payload.transactions,
      overwriteEditedDraft: input.overwriteEditedDraft,
    });
    if ("error" in result) return result;
    const focused = await setInvoiceFocus(tenantId, sessionId, result.batchId);
    if (!focused) {
      throw new Error("A sessão Eve não estava persistida para guardar o foco da fatura.");
    }

    // Consumida: o rascunho é a única fonte a partir daqui. Fora da transação
    // da proposta de propósito — se a staging sobreviver a uma falha aqui, o
    // pior caso é uma re-proposta idempotente, nunca um lote perdido.
    await forTenant(
      tenantId,
      async (tx) =>
        tx.delete(extractionStagings).where(eq(extractionStagings.id, staged.id)),
      db,
    );

    return {
      batchId: result.batchId,
      status: "proposed" as const,
      issuer: result.issuer,
      invoiceLabel: result.invoiceLabel,
      periodEnd: result.periodEnd,
      dueDate: result.dueDate,
      transactionCount: result.transactionCount,
      ...(payload.warnings.length > 0 ? { extractionWarnings: payload.warnings } : {}),
      checksum: result.checksum,
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
