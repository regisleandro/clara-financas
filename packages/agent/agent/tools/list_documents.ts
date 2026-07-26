import { getDb } from "@clara-financas/db";
import { extractionStagings } from "@clara-financas/db/schema/extraction-staging";
import { batches, documents } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { desc, eq, inArray } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireTenantCaller } from "../lib/tenant";

/**
 * Todos os documentos — inclusive os que nenhuma outra lista mostra.
 *
 * `list_invoices` e o snapshot fazem `innerJoin` com `batches`: um documento
 * cuja extração falhou, ou cujo lote foi rejeitado, simplesmente não existia
 * para a conversa. E como o hash barra o reenvio do mesmo PDF, o documento
 * órfão ficava num limbo inalcançável — a pessoa perguntava "cadê a fatura que
 * eu mandei?" e a resposta honesta era inexprimível.
 *
 * Aqui o join é aberto: cada documento aparece com o estado do seu lote mais
 * recente (ou nenhum), e com a extração estacionada quando existe — que é o
 * que permite retomar o fluxo de onde ele parou.
 */
const LIMIT = 50;

export default defineTool({
  description:
    "Lists uploaded documents INCLUDING the ones no invoice list shows: extraction failed (no batch) or batch rejected. Each row carries the latest batch state and any staged extraction. Use for 'cadê o documento que enviei' and to resume a stalled upload — re-uploading the same PDF is blocked by hash, this is how you find it again.",
  inputSchema: z.object({
    withoutBatch: z
      .boolean()
      .optional()
      .describe("true = only documents that have no batch at all (extraction never proposed)."),
    limit: z.number().int().min(1).max(LIMIT).optional(),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const limit = input.limit ?? 20;

    return forTenant(
      tenantId,
      async (tx) => {
        const rows = await tx
          .select({
            id: documents.id,
            issuer: documents.issuer,
            kind: documents.kind,
            uploadedAt: documents.uploadedAt,
          })
          .from(documents)
          .where(eq(documents.tenantId, tenantId))
          .orderBy(desc(documents.uploadedAt))
          .limit(LIMIT + 1);

        const truncatedAll = rows.length > LIMIT;
        const page = truncatedAll ? rows.slice(0, LIMIT) : rows;
        const ids = page.map((row) => row.id);

        const [batchRows, stagedRows] =
          ids.length === 0
            ? [[], []]
            : await Promise.all([
                tx
                  .select({
                    id: batches.id,
                    documentId: batches.documentId,
                    status: batches.status,
                    checksumResult: batches.checksumResult,
                    createdAt: batches.createdAt,
                  })
                  .from(batches)
                  .where(inArray(batches.documentId, ids))
                  .orderBy(desc(batches.createdAt)),
                tx
                  .select({
                    id: extractionStagings.id,
                    documentId: extractionStagings.documentId,
                  })
                  .from(extractionStagings)
                  .where(inArray(extractionStagings.documentId, ids)),
              ]);

        // O lote mais recente conta a situação atual; um `rejected` antigo não
        // esconde um `proposed` novo.
        const latestBatch = new Map<string, (typeof batchRows)[number]>();
        for (const batch of batchRows) {
          if (!latestBatch.has(batch.documentId)) latestBatch.set(batch.documentId, batch);
        }
        const stagedByDocument = new Map(stagedRows.map((row) => [row.documentId, row.id]));

        const described = page.map((row) => {
          const batch = latestBatch.get(row.id);
          const stagedExtractionId = stagedByDocument.get(row.id);
          return {
            documentId: row.id,
            displayLabel: row.issuer ?? "Documento enviado",
            issuer: row.issuer,
            kind: row.kind,
            uploadedAt: row.uploadedAt.toISOString(),
            batch:
              batch === undefined
                ? null
                : { batchId: batch.id, status: batch.status, checksumResult: batch.checksumResult },
            ...(stagedExtractionId !== undefined ? { stagedExtractionId } : {}),
            // O que destrava cada estado, dito na linha — para o modelo não
            // ter de deduzir o próximo passo de um join.
            next:
              batch === undefined
                ? stagedExtractionId !== undefined
                  ? "extração pronta e sem lote: propose_batch_from_extraction"
                  : "sem lote e sem extração: delegue ao extrator"
                : batch.status === "rejected"
                  ? "lote descartado: para reaproveitar, delegue ao extrator e proponha de novo"
                  : null,
          };
        });

        const filtered =
          input.withoutBatch === true
            ? described.filter((row) => row.batch === null)
            : described;

        return {
          count: filtered.length,
          ...(truncatedAll
            ? {
                truncated: true as const,
                note: `Mostrando os ${LIMIT} documentos mais recentes; há mais.`,
              }
            : {}),
          documents: filtered.slice(0, limit),
        };
      },
      getDb(),
    );
  },
});
