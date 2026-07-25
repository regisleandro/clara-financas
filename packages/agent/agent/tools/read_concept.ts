import { getDb } from "@clara-financas/db";
import { concepts, BUNDLES } from "@clara-financas/db/schema/knowledge";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq, like } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { optionalText } from "../lib/schema";
import { requireTenantCaller } from "../lib/tenant";

/**
 * Lê conceitos OKF do espaço do usuário.
 *
 * Note o que NÃO está no inputSchema: `tenantId`. Ele vem de
 * `requireTenantCaller(ctx)`, derivado da sessão autenticada. Um tenantId
 * aceito por parâmetro seria bug de segurança, não parâmetro — o modelo não
 * decide de quem é o dado.
 *
 * Toda leitura passa por `forTenant`, então a RLS do banco vale mesmo que algo
 * acima falhe.
 */
export default defineTool({
  description:
    "Reads concepts from the user's knowledge. Use to consult categories, conventions, and rules from the constitution, or what has been learned about the person, before deciding a category or applying a rule.",
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
    type: optionalText().describe(
      'Filter by type, e.g. "Category", "AlertRule", "Convention".',
    ),
    prefix: optionalText().describe('Filter by path prefix, e.g. "categories/".'),
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
        .limit(50);

      // Numa listagem o corpo inteiro é ruído; num conceito específico é a
      // resposta. Enviar tudo sempre gastaria contexto à toa.
      const isSingle = input.conceptId !== undefined;

      return {
        bundle: input.bundle,
        count: rows.length,
        concepts: rows.map((row) => ({
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
