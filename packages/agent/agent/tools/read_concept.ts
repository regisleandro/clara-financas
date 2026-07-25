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
    "Lê conceitos do conhecimento do usuário. Use para consultar categorias, convenções e regras da constituição, ou o que já foi aprendido sobre a pessoa, antes de decidir categoria ou aplicar regra.",
  inputSchema: z.object({
    bundle: z
      .enum(BUNDLES)
      .describe(
        "constitution para o contrato do domínio (categorias, convenções, regras); learnings para o que foi aprendido sobre esta pessoa.",
      ),
    // optionalText trata "" como ausente: modelos preenchem campos opcionais
    // com string vazia, e isso viraria filtro `= ''` — que não casa com nada.
    conceptId: optionalText().describe(
      'ID exato do conceito, ex.: "categories/groceries". Omita para listar o bundle inteiro.',
    ),
    type: optionalText().describe(
      'Filtra por tipo, ex.: "Category", "AlertRule", "Convention".',
    ),
    prefix: optionalText().describe('Filtra por prefixo de caminho, ex.: "categories/".'),
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
