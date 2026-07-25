import "server-only";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Armazenamento de documentos.
 *
 * Local em desenvolvimento, Vercel Blob em produção. A chave sempre começa
 * pelo tenant, então um caminho nunca é adivinhável a partir de outro espaço
 * e a separação fica visível na própria estrutura.
 *
 * O PDF nunca entra no banco: o banco guarda a chave e o hash.
 */

const LOCAL_ROOT = resolve(process.cwd(), "../../.data/documents");

export type StoredDocument = {
  blobKey: string;
  contentHash: string;
  size: number;
};

export async function storeDocument(
  tenantId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<StoredDocument> {
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  // O hash no nome torna o reenvio do mesmo arquivo idempotente por natureza,
  // e o índice único (tenant, hash) fecha o caso no banco.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const key = `${tenantId}/${contentHash.slice(0, 16)}-${safeName}`;

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (typeof token === "string" && token.length > 0) {
    const { put } = await import("@vercel/blob");
    const result = await put(key, Buffer.from(bytes), {
      access: "public",
      token,
      contentType: "application/pdf",
      addRandomSuffix: false,
    });
    return { blobKey: result.url, contentHash, size: bytes.byteLength };
  }

  const path = join(LOCAL_ROOT, key);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, bytes);
  return { blobKey: path, contentHash, size: bytes.byteLength };
}

/** Assinatura de PDF: `%PDF-`. Extensão e content-type são do cliente. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}
