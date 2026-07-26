import "server-only";

import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { documents } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq } from "drizzle-orm";

/**
 * O registro do documento no banco — a única coisa que o banco guarda dele.
 *
 * Duas rotas chegam aqui: o registro de um upload direto ao Blob (produção) e o
 * upload através da função (desenvolvimento). Elas divergem em como os bytes
 * viajam e convergem exatamente aqui, para que a deduplicação e o formato do
 * `documentId` não tenham duas versões.
 */

export type ExistingDocument = { id: string; filename: string };

/**
 * Documento já registrado com este conteúdo, se houver.
 *
 * É o que sustenta a idempotência do reenvio, e no caminho direto ele vale
 * ainda mais: consultado ANTES do upload, um arquivo que já está no store não
 * sobe uma segunda vez.
 */
export async function findDocumentByHash(
  tenantId: string,
  contentHash: string,
): Promise<ExistingDocument | null> {
  const row = await forTenant(
    tenantId,
    async (tx) => {
      const [found] = await tx
        .select({ id: documents.id, filename: documents.filename })
        .from(documents)
        .where(and(eq(documents.tenantId, tenantId), eq(documents.contentHash, contentHash)))
        .limit(1);
      return found;
    },
    getDb(),
  );

  return row ?? null;
}

export type RegisteredDocument = { documentId: string; filename: string; reused: boolean };

/**
 * Registra o documento, ou devolve o que já existe com o mesmo conteúdo.
 *
 * O reenvio do mesmo arquivo devolve o documento existente em vez de criar
 * outro — evita lotes duplicados a partir de um clique repetido. A releitura
 * depois do conflito cobre a corrida entre dois uploads simultâneos do mesmo
 * arquivo, que o índice único (tenant, hash) barra no banco.
 */
export async function registerDocument(input: {
  tenantId: string;
  blobKey: string;
  filename: string;
  contentHash: string;
}): Promise<RegisteredDocument> {
  const existing = await findDocumentByHash(input.tenantId, input.contentHash);
  if (existing) return { documentId: existing.id, filename: existing.filename, reused: true };

  const documentId = `doc_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

  const inserted = await forTenant(
    input.tenantId,
    async (tx) => {
      const rows = await tx
        .insert(documents)
        .values({
          id: documentId,
          tenantId: input.tenantId,
          kind: "credit_card_invoice",
          blobKey: input.blobKey,
          filename: input.filename,
          contentHash: input.contentHash,
        })
        .onConflictDoNothing()
        .returning({ id: documents.id });
      return rows.length > 0;
    },
    getDb(),
  );

  if (inserted) return { documentId, filename: input.filename, reused: false };

  const raced = await findDocumentByHash(input.tenantId, input.contentHash);
  if (raced) return { documentId: raced.id, filename: raced.filename, reused: true };

  throw new Error("não foi possível registrar o documento");
}
