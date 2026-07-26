import { findDocumentByHash } from "@/lib/documents";
import { blobToken, documentPathname, isContentHash, MAX_DOCUMENT_BYTES } from "@/lib/storage";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * O passo que decide o que fazer com o arquivo — sem receber o arquivo.
 *
 * O cliente calcula o SHA-256 do PDF e manda só ele, com o nome e o tamanho.
 * Três respostas possíveis:
 *
 * - `reused` — este conteúdo já é um documento deste tenant. Nada sobe: o
 *   upload mais barato é o que não acontece.
 * - `direct` — sobe do browser direto para o Blob, no caminho que ESTE lado
 *   derivou. O arquivo não passa pela função.
 * - `proxy` — não há store configurado (desenvolvimento local), então o
 *   arquivo vai pela função mesmo, para o disco.
 *
 * Aqui também morrem cedo os erros que antes só apareciam depois do upload
 * inteiro: sessão ausente, tenant não pronto, arquivo grande demais.
 */
export async function POST(request: Request) {
  const context = await getTenantContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (context.status !== "ready") {
    return Response.json({ error: "tenant_not_ready" }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "corpo inválido" }, { status: 400 });
  }

  const { filename, contentHash, size } = (body ?? {}) as {
    filename?: unknown;
    contentHash?: unknown;
    size?: unknown;
  };

  if (typeof filename !== "string" || filename.length === 0) {
    return Response.json({ error: "nome do arquivo ausente" }, { status: 400 });
  }
  if (!isContentHash(contentHash)) {
    return Response.json({ error: "hash inválido" }, { status: 400 });
  }
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return Response.json({ error: "tamanho inválido" }, { status: 400 });
  }
  if (size > MAX_DOCUMENT_BYTES) {
    return Response.json({ error: "arquivo maior que 20 MB" }, { status: 413 });
  }

  const existing = await findDocumentByHash(context.tenantId, contentHash);
  if (existing) {
    return Response.json({ mode: "reused", documentId: existing.id, filename: existing.filename });
  }

  if (blobToken() === null) return Response.json({ mode: "proxy" });

  return Response.json({
    mode: "direct",
    pathname: documentPathname(context.tenantId, contentHash, filename),
  });
}
