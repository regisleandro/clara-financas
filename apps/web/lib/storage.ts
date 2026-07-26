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
 *
 * Em produção os bytes NÃO passam por aqui. O browser fala direto com o Blob
 * (ver `lib/document-upload.ts`) e este módulo só deriva o caminho, valida o
 * que voltou e guarda a chave. O caminho abaixo — receber o arquivo inteiro na
 * função e regravá-lo — existe apenas para o desenvolvimento sem conta de Blob.
 */

const LOCAL_ROOT = resolve(process.cwd(), "../../.data/documents");

/**
 * 20 MB. Fatura de cartão não passa disso; acima é engano ou abuso.
 *
 * Este teto só é honesto porque o upload é direto ao Blob. Enquanto o arquivo
 * atravessava a função, o limite real era o da plataforma — 4,5 MB de corpo de
 * requisição numa Vercel Function — e uma fatura de 6 MB morria num 413 que
 * vinha da infraestrutura, antes deste código rodar, sem mensagem para
 * ninguém.
 */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export type StoredDocument = {
  blobKey: string;
  contentHash: string;
  size: number;
};

/**
 * O caminho do documento no store, derivado do CONTEÚDO.
 *
 * É o servidor que deriva, sempre — nunca o cliente. O prefixo do tenant é o
 * que separa os espaços, e o hash no nome faz o reenvio do mesmo arquivo cair
 * na MESMA chave. Quem registra um upload direto tem de mandar de volta
 * exatamente esta string: comparar por igualdade dispensa qualquer análise de
 * `../` ou de prefixo alheio.
 */
export function documentPathname(tenantId: string, contentHash: string, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  return `${tenantId}/${contentHash.slice(0, 16)}-${safeName}`;
}

/** SHA-256 em hexadecimal, como o cliente o calcula com a WebCrypto. */
export function isContentHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function blobToken(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/**
 * Confere que o blob recém-gravado existe, é nosso e é o que foi prometido.
 *
 * O cliente devolve o URL que o Blob lhe deu, e URL vindo do cliente é
 * afirmação, não prova. Um `head` autenticado resolve os dois lados de uma vez:
 * prova que o objeto existe no NOSSO store (o token só abre o nosso) e diz o
 * caminho, o tamanho e o content-type reais, que conferimos contra o que
 * derivamos do tenant e do hash.
 */
export async function verifyUploadedBlob(
  url: string,
  expectedPathname: string,
): Promise<{ ok: true; size: number } | { ok: false; error: string }> {
  const token = blobToken();
  if (token === null) return { ok: false, error: "armazenamento indisponível" };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "url inválida" };
  }
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".blob.vercel-storage.com")) {
    return { ok: false, error: "url fora do armazenamento" };
  }

  const { head } = await import("@vercel/blob");

  let blob: Awaited<ReturnType<typeof head>>;
  try {
    blob = await head(url, { token });
  } catch {
    return { ok: false, error: "arquivo não encontrado no armazenamento" };
  }

  if (blob.pathname !== expectedPathname) return { ok: false, error: "caminho divergente" };
  if (blob.size > MAX_DOCUMENT_BYTES) return { ok: false, error: "arquivo maior que 20 MB" };
  if (!blob.contentType.startsWith("application/pdf")) {
    return { ok: false, error: "o arquivo não é um PDF" };
  }

  return { ok: true, size: blob.size };
}

/**
 * Recebe os bytes e grava — o caminho do DESENVOLVIMENTO.
 *
 * Em produção ninguém chama isto: o arquivo vai do browser direto para o Blob.
 * Aqui ele existe porque o desenvolvimento não deve exigir uma conta de Blob, e
 * sem token não há upload direto possível.
 */
export async function storeDocument(
  tenantId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<StoredDocument> {
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const key = documentPathname(tenantId, contentHash, filename);

  const token = blobToken();
  if (token !== null) {
    const { put } = await import("@vercel/blob");
    const result = await put(key, Buffer.from(bytes), {
      // PRIVADO, não público. Uma fatura de cartão num URL público fica
      // legível para sempre por qualquer um que o obtenha — e o URL circula:
      // vai para a coluna `blob_key`, para logs, para um dump de banco, para
      // um header de referer. "Difícil de adivinhar" não é controle de acesso;
      // é obscuridade, e obscuridade não sobrevive a um vazamento de texto.
      //
      // Com `private`, ler o blob exige o token do store, que só existe no
      // ambiente dos dois deployments. O upload direto mantém a mesma
      // propriedade: o cliente também grava com `access: "private"`.
      access: "private",
      token,
      contentType: "application/pdf",
      addRandomSuffix: false,
      // A chave é derivada do CONTEÚDO, então reescrever é gravar os mesmos
      // bytes por cima dos mesmos bytes. Sem isto o `put` recusa a segunda
      // gravação com "This blob already exists" e o reenvio vira 500 — que é
      // exatamente o oposto da idempotência que a chave promete.
      //
      // O dedutor de verdade é o índice único (tenant, hash) no banco, que
      // devolve o documento existente logo depois. Este `put` repetido é só o
      // preço de descobrir isso um passo tarde demais.
      allowOverwrite: true,
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
