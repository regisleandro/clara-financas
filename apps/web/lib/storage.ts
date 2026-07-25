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
      // PRIVADO, não público. Uma fatura de cartão num URL público fica
      // legível para sempre por qualquer um que o obtenha — e o URL circula:
      // vai para a coluna `blob_key`, para logs, para um dump de banco, para
      // um header de referer. "Difícil de adivinhar" não é controle de acesso;
      // é obscuridade, e obscuridade não sobrevive a um vazamento de texto.
      //
      // Com `private`, ler o blob exige o token do store, que só existe no
      // ambiente dos dois deployments.
      access: "private",
      token,
      contentType: "application/pdf",
      addRandomSuffix: false,
    });
    return { blobKey: result.url, contentHash, size: bytes.byteLength };
  }

  // O caminho local existe para o desenvolvimento não exigir uma conta de
  // Blob. Num runtime serverless ele não existe: o sistema de arquivos é
  // somente-leitura fora de /tmp, e /tmp morre com a invocação. Sem este
  // guarda, o deploy sobe inteiro e quebra no primeiro upload com `EROFS`,
  // que não diz a ninguém qual variável falta.
  if (process.env.VERCEL !== undefined) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN não está definida. Em produção os PDFs vão para o " +
        "Vercel Blob; o armazenamento local só existe em desenvolvimento.",
    );
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
