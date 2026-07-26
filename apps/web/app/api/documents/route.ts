import { registerDocument } from "@/lib/documents";
import {
  documentPathname,
  isContentHash,
  looksLikePdf,
  MAX_DOCUMENT_BYTES,
  storeDocument,
  verifyUploadedBlob,
} from "@/lib/storage";
import { getTenantContext, type TenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Registra o documento e devolve o `documentId` que a conversa usa.
 *
 * Dois corpos, um resultado. `application/json` REGISTRA um upload que o
 * browser já fez direto no Blob — é o caminho normal, e nele o PDF nunca
 * atravessa esta função. `multipart/form-data` ainda recebe o arquivo inteiro,
 * e existe só para o desenvolvimento sem conta de Blob.
 *
 * O tenant vem da sessão, nunca do corpo da requisição.
 */
export async function POST(request: Request) {
  const context = await getTenantContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (context.status !== "ready") {
    return Response.json({ error: "tenant_not_ready" }, { status: 409 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  return contentType.includes("application/json")
    ? registerDirectUpload(context, request)
    : receiveThroughFunction(context, request);
}

/**
 * O caminho normal: o arquivo já está no Blob, e aqui só se confere e registra.
 *
 * Nada do que o cliente afirma é aceito como está. O caminho é RE-DERIVADO a
 * partir do tenant da sessão e do hash, e tem de bater exatamente com o que
 * veio; o URL é conferido com um `head` autenticado, que só enxerga o nosso
 * store. Se o cliente mentir sobre o hash, mente sobre a identidade do próprio
 * arquivo — e o pior que consegue é deduplicar contra si mesmo, dentro do
 * próprio espaço.
 */
async function registerDirectUpload(context: TenantContext, request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "corpo inválido" }, { status: 400 });
  }

  const { url, pathname, filename, contentHash } = (body ?? {}) as {
    url?: unknown;
    pathname?: unknown;
    filename?: unknown;
    contentHash?: unknown;
  };

  if (typeof url !== "string" || typeof filename !== "string" || filename.length === 0) {
    return Response.json({ error: "registro incompleto" }, { status: 400 });
  }
  if (!isContentHash(contentHash)) {
    return Response.json({ error: "hash inválido" }, { status: 400 });
  }

  const expected = documentPathname(context.tenantId, contentHash, filename);
  if (pathname !== expected) {
    return Response.json({ error: "caminho divergente" }, { status: 400 });
  }

  const verified = await verifyUploadedBlob(url, expected);
  if (!verified.ok) return Response.json({ error: verified.error }, { status: 400 });

  const registered = await registerDocument({
    tenantId: context.tenantId,
    blobKey: url,
    filename,
    contentHash,
  });

  return Response.json(registered);
}

/**
 * O caminho do desenvolvimento: o arquivo inteiro passa pela função.
 *
 * Em produção isto não é alcançado — `prepare` responde `direct` sempre que há
 * store configurado. E é bom que não seja: uma Vercel Function recusa corpos
 * acima de 4,5 MB antes de qualquer código rodar, então uma fatura grande
 * morreria aqui com um erro que não é nosso.
 */
async function receiveThroughFunction(context: TenantContext, request: Request) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "arquivo ausente" }, { status: 400 });
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return Response.json({ error: "arquivo maior que 20 MB" }, { status: 413 });
  }

  // O arquivo é validado pela assinatura `%PDF-`, não pela extensão nem pelo
  // content-type — os dois são declarados pelo cliente e portanto não são
  // evidência. No caminho direto quem faz este papel é o `allowedContentTypes`
  // do token, mais o parser que roda no browser antes de subir.
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) {
    return Response.json(
      { error: "o arquivo não é um PDF (assinatura inválida)" },
      { status: 415 },
    );
  }

  const stored = await storeDocument(context.tenantId, file.name, bytes);

  const registered = await registerDocument({
    tenantId: context.tenantId,
    blobKey: stored.blobKey,
    filename: file.name,
    contentHash: stored.contentHash,
  });

  return Response.json(registered);
}
