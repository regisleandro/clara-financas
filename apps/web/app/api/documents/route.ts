import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { documents } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq } from "drizzle-orm";

import { looksLikePdf, storeDocument } from "@/lib/storage";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** 20 MB. Fatura de cartão não passa disso; acima é engano ou abuso. */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Recebe o PDF e devolve o `documentId` que a conversa usa.
 *
 * O tenant vem da sessão, nunca do corpo da requisição. O arquivo é validado
 * pela assinatura `%PDF-`, não pela extensão nem pelo content-type — os dois
 * são declarados pelo cliente e portanto não são evidência.
 */
export async function POST(request: Request) {
  const context = await getTenantContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (context.status !== "ready") {
    return Response.json({ error: "tenant_not_ready" }, { status: 409 });
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "arquivo ausente" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "arquivo maior que 20 MB" }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) {
    return Response.json(
      { error: "o arquivo não é um PDF (assinatura inválida)" },
      { status: 415 },
    );
  }

  const stored = await storeDocument(context.tenantId, file.name, bytes);
  const db = getDb();

  const existing = await forTenant(
    context.tenantId,
    async (tx) => {
      const [row] = await tx
        .select({ id: documents.id, filename: documents.filename })
        .from(documents)
        .where(
          and(
            eq(documents.tenantId, context.tenantId),
            eq(documents.contentHash, stored.contentHash),
          ),
        )
        .limit(1);
      return row;
    },
    db,
  );

  // Reenvio do mesmo arquivo devolve o documento já existente em vez de criar
  // outro — evita lotes duplicados a partir de um clique repetido.
  if (existing) {
    return Response.json({ documentId: existing.id, filename: existing.filename, reused: true });
  }

  const documentId = `doc_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

  await forTenant(
    context.tenantId,
    async (tx) => {
      await tx.insert(documents).values({
        id: documentId,
        tenantId: context.tenantId,
        kind: "credit_card_invoice",
        blobKey: stored.blobKey,
        filename: file.name,
        contentHash: stored.contentHash,
      });
    },
    db,
  );

  return Response.json({ documentId, filename: file.name, reused: false });
}
