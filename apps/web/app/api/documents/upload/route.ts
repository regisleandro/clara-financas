import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

import { MAX_DOCUMENT_BYTES } from "@/lib/storage";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** 10 minutos: tempo de subir 20 MB numa conexão ruim, e nada além disso. */
const TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * Emite o token de escrita para o browser gravar no Blob — e só isso.
 *
 * O arquivo não passa por aqui. O que passa é uma decisão: este usuário pode
 * gravar NESTE caminho, com este tipo, até este tamanho, por este tempo. Sem a
 * checagem de prefixo abaixo, um token emitido para uma pessoa gravaria no
 * espaço de outra — a separação por tenant deixaria de existir no exato ponto
 * em que ela é escrita.
 *
 * `onUploadCompleted` NÃO é usado de propósito. Ele é um webhook que a Vercel
 * chama num URL público, então não dispara em localhost — o registro do
 * documento dependeria de infraestrutura que o desenvolvimento não tem. Quem
 * registra é o cliente, com um POST em /api/documents logo depois do upload, e
 * lá o blob é conferido com um `head` autenticado antes de virar linha no
 * banco.
 */
export async function POST(request: Request) {
  const context = await getTenantContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (context.status !== "ready") {
    return Response.json({ error: "tenant_not_ready" }, { status: 409 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // O caminho vem do cliente, mas foi ESTE servidor que o derivou em
        // /api/documents/prepare. Exigir o prefixo do tenant é o que impede
        // que um cliente modificado peça um token para o espaço alheio.
        if (!pathname.startsWith(`${context.tenantId}/`)) {
          throw new Error("caminho fora do espaço do tenant");
        }

        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: MAX_DOCUMENT_BYTES,
          validUntil: Date.now() + TOKEN_TTL_MS,
          // O nome já carrega o hash do conteúdo: sufixo aleatório quebraria a
          // idempotência que a chave promete, e reescrever é gravar os mesmos
          // bytes por cima dos mesmos bytes.
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
    });

    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "falha ao autorizar o upload" },
      { status: 400 },
    );
  }
}
