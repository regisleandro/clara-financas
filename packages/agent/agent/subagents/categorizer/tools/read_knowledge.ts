import { getDb } from "@clara-financas/db";
import { concepts, BUNDLES } from "@clara-financas/db/schema/knowledge";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq, like } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { optionalText } from "../../../lib/schema";
import { requireTenantCaller } from "../../../lib/tenant";

/**
 * Leitura de conceitos OKF, autorada aqui porque subagente não herda tools.
 *
 * É o `read_concept` do coordenador com a descrição voltada ao trabalho do
 * guarda-livros: categorias válidas, regras aprendidas (`rules/`) e aliases
 * de comerciante (`merchants/`). Sem `tenantId` no input — ele vem da sessão
 * autenticada, nunca do modelo.
 */
/** Teto de leitura. O que passa disso é anunciado, nunca cortado calado. */
const LIMIT = 50;

export default defineTool({
  description:
    "Reads concepts from the user's knowledge: valid categories (type Category), learned categorisation rules (prefix rules/), and merchant aliases (prefix merchants/). Consult before proposing a category or an alias.",
  inputSchema: z.object({
    bundle: z
      .enum(BUNDLES)
      .describe(
        "constitution for the domain contract (categories, conventions, rules); learnings for what has been learned about this person.",
      ),
    // optionalText trata "" como ausente: modelos preenchem campos opcionais
    // com string vazia, e isso viraria filtro `= ''` — que não casa com nada.
    conceptId: optionalText().describe(
      'Exact concept id, e.g. "categories/groceries". Omit to list the whole bundle.',
    ),
    type: optionalText().describe('Filter by type, e.g. "Category", "CategorizationRule", "MerchantAlias".'),
    prefix: optionalText().describe('Filter by path prefix, e.g. "categories/", "rules/", "merchants/".'),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);

    return forTenant(tenantId, async (tx) => {
      const filters = [eq(concepts.bundle, input.bundle)];

      if (input.conceptId !== undefined) {
        filters.push(eq(concepts.conceptId, input.conceptId));
      }
      if (input.type !== undefined) {
        filters.push(eq(concepts.type, input.type));
      }
      if (input.prefix !== undefined) {
        filters.push(like(concepts.conceptId, `${input.prefix}%`));
      }

      const rows = await tx
        .select({
          conceptId: concepts.conceptId,
          type: concepts.type,
          frontmatter: concepts.frontmatter,
          body: concepts.body,
        })
        .from(concepts)
        .where(and(...filters))
        // Pede um a mais que o teto só para saber se havia mais — o custo é uma
        // linha e o que ele compra é a diferença entre "são estes" e "são estes
        // e há outros".
        .limit(LIMIT + 1);

      // Numa listagem o corpo inteiro é ruído; num conceito específico é a
      // resposta. Enviar tudo sempre gastaria contexto à toa.
      const isSingle = input.conceptId !== undefined;

      // Truncar em silêncio era mentir com número: `count` dizia 50, o modelo
      // concluía que aquilo era o total, e uma categoria fora da janela virava
      // "não existe". É o mesmo defeito que a tool já corrigiu para o caso
      // vazio, e que continuava de pé no caso cheio.
      const truncated = rows.length > LIMIT;
      const page = truncated ? rows.slice(0, LIMIT) : rows;

      return {
        bundle: input.bundle,
        count: page.length,
        ...(truncated
          ? {
              truncated: true as const,
              note: `Mostrando ${LIMIT} conceitos; há mais. Filtre por type ou prefix para ver o resto.`,
            }
          : {}),
        concepts: page.map((row) => ({
          id: row.conceptId,
          type: row.type,
          title: row.frontmatter.title,
          description: row.frontmatter.description,
          ...(isSingle ? { body: row.body } : {}),
        })),
      };
    }, getDb());
  },
});
