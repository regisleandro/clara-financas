import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { concepts, conceptRevisions } from "@clara-financas/db/schema/knowledge";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { optionalText } from "../lib/schema";
import { requireTenantCaller, tenantIdOf } from "../lib/tenant";

/**
 * O SEGUNDO GATE: escrita na memória semântica.
 *
 * É aqui que a hipótese H4 se realiza — o sistema aprende, mas cada
 * aprendizado é um conceito legível, versionado e reversível, e nenhum entra
 * sem a pessoa aprovar.
 *
 * Três invariantes que o executor garante, não o modelo:
 *  1. Só escreve no bundle `learnings`. A constituição é contrato, alterada
 *     por edição direta no repositório — nunca pela conversa.
 *  2. Toda escrita insere uma revisão em `concept_revisions`, que é
 *     append-only no banco. A trilha não depende de lembrarmos de registrar.
 *  3. `verified: [{ by: "human:<userId>" }]` carimba quem aprovou, na
 *     convenção de ator do OKF §7. É a prova de que o gate foi honrado.
 */
const AGENT_ACTOR = "clara/coordinator@0.1";

/**
 * `Category` está aqui de propósito.
 *
 * A constituição semeia uma taxonomia inicial, mas gasto é pessoal: quem tem
 * animal precisa de Pets, quem não tem, não. Taxonomia fixa força o modelo a
 * encaixar o que não encaixa — observado em fatura real, `cloud_services` foi
 * parar em `transport` porque não havia para onde ir.
 *
 * Categoria aprendida é a hipótese H4 aplicada onde ela mais aparece: passa
 * pelo gate, fica legível e é reversível como qualquer outro aprendizado.
 */
const LEARNED_TYPES = [
  "Category",
  "Merchant",
  "CategorizationRule",
  "Commitment",
  "IssuerPattern",
] as const;

export default defineTool({
  description:
    "Records a learning about this person (categorisation rule, merchant, commitment, issuer pattern). Requires explicit approval. Use after proposing the rule in conversation and the person agreeing.",
  inputSchema: z.object({
    conceptId: z
      .string()
      .min(1)
      .regex(
        /^[a-z0-9][a-z0-9/-]*$/,
        "use caminho em minúsculas, ex.: merchants/padaria-central",
      )
      .describe('Caminho dentro do bundle, sem .md. Ex.: "rules/nuvem-digital".'),
    type: z.enum(LEARNED_TYPES),
    title: z.string().min(1).describe("Short, readable title, in Brazilian Portuguese."),
    description: optionalText().describe("One line explaining the rule, in Brazilian Portuguese."),
    body: z
      .string()
      .min(1)
      .describe(
        "Markdown body, written in Brazilian Portuguese. To reference another concept use an absolute markdown link, e.g. [Assinaturas](/categories/subscriptions.md).",
      ),
    reason: optionalText().describe("Why this learning exists. Write it in Brazilian Portuguese."),
  }),

  approval: (ctx) => {
    const current = tenantIdOf(ctx.session.auth.current);
    if (current === undefined || current !== tenantIdOf(ctx.session.auth.initiator)) {
      return { type: "denied", reason: "A sessão não está fixada a um único usuário." };
    }
    return "user-approval";
  },

  async execute(input, ctx) {
    const { tenantId, userId } = requireTenantCaller(ctx);
    const now = new Date();
    const isoNow = now.toISOString();

    return forTenant(
      tenantId,
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(concepts)
          .where(
            and(
              eq(concepts.tenantId, tenantId),
              eq(concepts.bundle, "learnings"),
              eq(concepts.conceptId, input.conceptId),
            ),
          )
          .limit(1);

        const frontmatter = {
          type: input.type,
          title: input.title,
          ...(input.description !== undefined ? { description: input.description } : {}),
          status: "stable" as const,
          generated: { by: AGENT_ACTOR, at: isoNow },
          // Convenção de ator do OKF §7. É a prova de que uma pessoa aprovou.
          verified: [
            ...(existing?.frontmatter.verified ?? []),
            { by: `human:${userId}`, at: isoNow },
          ],
        };

        const rowId = existing?.id ?? `cpt_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

        if (existing) {
          await tx
            .update(concepts)
            .set({ type: input.type, frontmatter, body: input.body })
            .where(eq(concepts.id, existing.id));
        } else {
          await tx.insert(concepts).values({
            id: rowId,
            tenantId,
            bundle: "learnings",
            conceptId: input.conceptId,
            type: input.type,
            frontmatter,
            body: input.body,
          });
        }

        // A revisão registra o estado NOVO. Como a tabela é append-only, o
        // histórico completo é a sequência delas — e `revert` é escrever de
        // volta um corpo antigo, nunca apagar.
        await tx.insert(conceptRevisions).values({
          id: `rev_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
          tenantId,
          conceptRowId: rowId,
          author: `human:${userId}`,
          reason: input.reason ?? (existing ? "conceito atualizado" : "conceito criado"),
          frontmatter,
          body: input.body,
        });

        return {
          conceptId: input.conceptId,
          bundle: "learnings" as const,
          action: existing ? ("updated" as const) : ("created" as const),
          verifiedBy: `human:${userId}`,
        };
      },
      getDb(),
    );
  },
});
