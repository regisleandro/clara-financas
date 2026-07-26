import { getDb } from "@clara-financas/db";
import { conceptRevisions, concepts, type Bundle } from "@clara-financas/db/schema/knowledge";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, desc, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { notFound } from "../lib/errors";
import { requireTenantCaller } from "../lib/tenant";

/**
 * O histórico de um conceito — a metade que faltava do revert.
 *
 * `save_concept` sempre prometeu: "revert é escrever de volta um corpo
 * antigo". Só que `concept_revisions` era append-only SEM leitor — não havia
 * como ver o corpo antigo para escrevê-lo de volta. A promessa apontava para
 * uma porta que não existia, o mesmo defeito que `create_adjustment` teve um
 * dia.
 *
 * Cada revisão guarda o frontmatter e o corpo completos do estado que ela
 * gravou. Reverter é: ler aqui, escolher a revisão, e chamar `save_concept`
 * com aquele corpo — o revert vira uma revisão nova, e a trilha continua
 * contando a história inteira.
 */
const LIMIT = 20;

export default defineTool({
  description:
    "Reads the revision history of one concept (learned rule, alias, category), newest first, each with the full body it recorded. To revert a concept, pick the revision and call save_concept with that body — the revert becomes a new revision, nothing is erased.",
  inputSchema: z.object({
    conceptId: z
      .string()
      .min(1)
      .describe("The concept path, e.g. 'rules/mercado-sao-jose' — as shown by read_concept."),
    bundle: z.enum(["constitution", "learnings"]).optional().describe("Defaults to learnings."),
    limit: z.number().int().min(1).max(LIMIT).optional(),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const bundle: Bundle = input.bundle ?? "learnings";
    const limit = input.limit ?? LIMIT;

    return forTenant(
      tenantId,
      async (tx) => {
        // As revisões apontam para a ROW do conceito, não para o caminho OKF —
        // o caminho pode ser reusado após um descarte, a row não.
        const [concept] = await tx
          .select({ rowId: concepts.id, type: concepts.type })
          .from(concepts)
          .where(
            and(
              eq(concepts.tenantId, tenantId),
              eq(concepts.bundle, bundle),
              eq(concepts.conceptId, input.conceptId),
            ),
          )
          .limit(1);

        if (concept === undefined) {
          return notFound(
            "conceito_nao_encontrado",
            `Nenhum conceito '${input.conceptId}' no bundle ${bundle}.`,
            { hint: "Liste os conceitos com read_concept (prefix ou type) para achar o caminho certo." },
          );
        }

        const rows = await tx
          .select()
          .from(conceptRevisions)
          .where(
            and(
              eq(conceptRevisions.tenantId, tenantId),
              eq(conceptRevisions.conceptRowId, concept.rowId),
            ),
          )
          .orderBy(desc(conceptRevisions.createdAt))
          .limit(limit + 1);

        const truncated = rows.length > limit;
        const page = truncated ? rows.slice(0, limit) : rows;

        return {
          conceptId: input.conceptId,
          bundle,
          type: concept.type,
          count: page.length,
          ...(truncated
            ? {
                truncated: true as const,
                note: `Mostrando as ${limit} revisões mais recentes; há mais.`,
              }
            : {}),
          revisions: page.map((row, index) => ({
            revisionId: row.id,
            // A mais recente É o estado atual do conceito: toda escrita de
            // save_concept grava a revisão junto.
            ...(index === 0 ? { current: true as const } : {}),
            author: row.author,
            reason: row.reason,
            createdAt: row.createdAt.toISOString(),
            title: row.frontmatter?.title ?? null,
            body: row.body,
          })),
          revert:
            "Para reverter: chame save_concept com o MESMO conceptId e o body/title da revisão escolhida, explicando no reason que é uma reversão. Vira revisão nova; nada é apagado.",
        };
      },
      getDb(),
    );
  },
});
