import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { extractionStagings } from "@clara-financas/db/schema/extraction-staging";
import { documents } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { ExtractionResultSchema } from "@clara-financas/views/agent-contracts";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";

import { notFound } from "../../../lib/errors";
import { requireTenantCaller } from "../../../lib/tenant";

/**
 * Persiste a extração completa e devolve só o recibo.
 *
 * É a metade do extrator na passagem por REFERÊNCIA: as 100+ linhas lidas do
 * PDF não voltam mais pelo contexto do coordenador — ficam na staging, e o
 * recibo carrega o `extractionId` que `propose_batch_from_extraction` consome.
 *
 * Sobre o isolamento: a invariante do extrator sempre foi "não alcança o
 * razão", e ela continua de pé — esta tool escreve numa tabela de staging
 * descartável, sem grant algum sobre `batches`/`transactions`. O que mudou é
 * que "nenhuma tool de escrita" virou "nenhuma escrita no razão".
 */
export default defineTool({
  description:
    "Persists the complete extraction of a document and returns an extractionId. Call EXACTLY ONCE, with every transaction you read, right before returning your structured result. Your final output must be the receipt — the coordinator proposes the batch from the extractionId, so never retype the transactions anywhere else.",
  inputSchema: ExtractionResultSchema,
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const db = getDb();

    // Revalidação explícita: o inputSchema já validou a forma, o parse aplica
    // os defaults (warnings) e garante que o payload persistido é exatamente o
    // contrato — não o que o transporte deixou passar.
    const payload = ExtractionResultSchema.parse(input);
    const extractionId = `ext_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    // A sessão do PAI, quando esta tool roda dentro de um subagente delegado:
    // chave de correlação que nenhum modelo digita.
    const parentSessionId = ctx.session.parent?.sessionId ?? null;

    const result = await forTenant(
      tenantId,
      async (tx) => {
        const [document] = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.id, payload.documentId), eq(documents.tenantId, tenantId)))
          .limit(1);

        if (document === undefined) {
          return notFound(
            "documento_nao_encontrado",
            `Nenhum documento com o id ${payload.documentId}.`,
            { hint: "Use o documentId exatamente como veio na requisição do coordenador." },
          );
        }

        // Uma extração por documento: refazer a leitura substitui a anterior,
        // no mesmo espírito da idempotência de proposta por documento.
        await tx
          .delete(extractionStagings)
          .where(
            and(
              eq(extractionStagings.tenantId, tenantId),
              eq(extractionStagings.documentId, payload.documentId),
            ),
          );

        await tx.insert(extractionStagings).values({
          id: extractionId,
          tenantId,
          documentId: payload.documentId,
          parentSessionId,
          payload,
        });

        return { ok: true as const };
      },
      db,
    );

    if ("error" in result) return result;

    return {
      extractionId,
      documentId: payload.documentId,
      transactionCount: payload.transactions.length,
      note: "Extração guardada. Devolva o recibo com este extractionId — não repita as transações no texto.",
    };
  },
});
