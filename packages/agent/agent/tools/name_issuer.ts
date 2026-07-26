import { getDb } from "@clara-financas/db";
import { documents } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { notFound, refused } from "../lib/errors";
import { canonicalIssuer } from "../lib/issuer-canonical";
import { requireTenantCaller } from "../lib/tenant";

/**
 * Nomeia a operadora de um documento que o extrator não identificou.
 *
 * O efeito é maior do que parece: enquanto o documento não tem emissor, TODAS
 * as transações dele caem na linha "Sem operadora" da visão cruzada por
 * operadora e mês. Uma escrita resolve a fatura inteira, porque o emissor é do
 * DOCUMENTO, não da linha.
 *
 * Sem gate: não toca em valor, data nem categoria — é o nome de quem emitiu o
 * papel, e a pessoa acabou de dizê-lo. A tela de revisão já fazia exatamente
 * isto sem cerimônia (`nameDocumentIssuer`); a conversa não tinha como.
 */
export default defineTool({
  description:
    "Names the issuer of a document whose extraction could not identify it — until then every entry of that invoice falls under 'Sem operadora' in the issuer view. Use when the person says which card or bank the invoice is from. No approval card: it changes no financial value.",
  inputSchema: z.object({
    documentId: z.string().min(1),
    issuer: z
      .string()
      .min(1)
      .max(80)
      .describe("Issuer name as the person says it, e.g. the bank or card brand."),
  }),

  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const issuer = input.issuer.trim();

    if (issuer === "") {
      return refused("operacao_nao_permitida", "O nome da operadora chegou vazio.");
    }

    return forTenant(
      tenantId,
      async (tx) => {
        const [before] = await tx
          .select({ id: documents.id, issuer: documents.issuer, filename: documents.filename })
          .from(documents)
          .where(and(eq(documents.tenantId, tenantId), eq(documents.id, input.documentId)))
          .limit(1);

        if (before === undefined) {
          return notFound(
            "documento_nao_encontrado",
            `Nenhum documento com o id ${input.documentId}.`,
            { hint: "Os documentId aparecem em list_invoices e em read_batch." },
          );
        }

        // "NUBANK" dito agora e "Nubank" gravado antes são a mesma operadora:
        // a grafia existente vence, para a matriz por operadora não ganhar
        // duas linhas da mesma casa.
        const canonical = await canonicalIssuer(tx, tenantId, issuer);

        await tx
          .update(documents)
          .set({ issuer: canonical })
          .where(and(eq(documents.id, before.id), eq(documents.tenantId, tenantId)));

        return {
          documentId: before.id,
          filename: before.filename,
          previousIssuer: before.issuer,
          issuer: canonical,
          ...(canonical !== issuer
            ? { note: `Grafia unificada com a operadora já registrada: "${canonical}".` }
            : {}),
          // Só há o que desfazer se havia nome antes: um documento que nunca
          // teve operadora não volta a "sem operadora" por esta porta, e
          // prometer isso ao modelo seria oferecer uma chamada que o schema
          // recusa (o nome é obrigatório).
          ...(before.issuer !== null
            ? { undo: { tool: "name_issuer", documentId: before.id, issuer: before.issuer } }
            : {}),
        };
      },
      getDb(),
    );
  },
});
