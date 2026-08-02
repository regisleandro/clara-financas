import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { transactions } from "@clara-financas/db/schema/ledger";
import { transactionReclassifications } from "@clara-financas/db/schema/reclassification";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { CategorizationArtifactSchema } from "@clara-financas/views/agent-contracts";
import { and, eq, inArray } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { readArtifact } from "../lib/artifacts";
import { loadValidCategories, unknownCategory } from "../lib/category-scope";
import { toolError } from "../lib/errors";
import { optionalText } from "../lib/schema";
import { requireTenantCaller, tenantIdOf } from "../lib/tenant";

/**
 * Reclassifica transações já confirmadas.
 *
 * Passa pelo gate porque muda o SENTIDO do razão: toda análise por categoria
 * enxerga outra coisa depois disto. Não muda os fatos — valor, data, descrição
 * e origem seguem intocáveis, garantido pelo trigger do banco.
 *
 * Cada mudança grava uma linha em `transaction_reclassifications`, que é
 * append-only. Reclassificar é permitido; reclassificar em silêncio, não.
 */
export default defineTool({
  description:
    "Requests approval to change categories. Prefer artifactId + proposalIds from the bookkeeper; for one explicit correction pass one direct change. Every category write, including one entry, opens the approval card.",
  inputSchema: z.union([
    z.object({
      changes: z
        .array(
          z.object({
            transactionId: z.string().min(1),
            category: z.string().min(1),
            categoryLabel: z.string().min(1),
          }),
        )
        .min(1)
        .max(500),
      reason: optionalText(),
      byConceptId: optionalText(),
    }),
    z.object({
      artifactId: z.string().regex(/^art_[a-z0-9]+$/),
      proposalIds: z.array(z.string().min(1)).min(1).max(500),
      reason: optionalText(),
    }),
  ]),

  approval: (ctx) => {
    const current = tenantIdOf(ctx.session.auth.current);
    if (current === undefined || current !== tenantIdOf(ctx.session.auth.initiator)) {
      return { type: "denied", reason: "A sessão não está fixada a um único usuário." };
    }
    return "user-approval";
  },

  async execute(input, ctx) {
    const { tenantId, userId } = requireTenantCaller(ctx);
    const db = getDb();
    let changes: Array<{ transactionId: string; category: string; categoryLabel: string }>;
    let byConceptId: string | undefined;

    if ("artifactId" in input) {
      const stored = await readArtifact<unknown>(input.artifactId, "categorization", ctx);
      if ("error" in stored) return stored;
      const parsed = CategorizationArtifactSchema.safeParse(stored.payload);
      if (!parsed.success) {
        return toolError("artefato_invalido", "A proposta de categorias está inválida.", {
          hint: "Delegue novamente ao categorizador; não reconstrua os ids.",
        });
      }
      const wanted = new Set(input.proposalIds);
      const actionable = [
        ...parsed.data.matchedRules.map((proposal) => ({
          proposalId: proposal.proposalId,
          category: proposal.categoryId,
          categoryLabel: proposal.categoryLabel,
          transactionIds: proposal.transactionIds,
          conceptId: proposal.conceptId,
        })),
        ...parsed.data.proposals.flatMap((proposal) =>
          proposal.categoryId === null || proposal.categoryLabel === null
            ? []
            : [
                {
                  proposalId: proposal.proposalId,
                  category: proposal.categoryId,
                  categoryLabel: proposal.categoryLabel,
                  transactionIds: proposal.transactionIds,
                  conceptId: undefined,
                },
              ],
        ),
      ];
      const selected = actionable.filter((proposal) => wanted.has(proposal.proposalId));
      if (selected.length !== wanted.size) {
        return toolError(
          "alcance_alterado",
          "A seleção contém propostas que não existem ou não aplicam uma categoria.",
          { hint: "Use somente actionableCategoryProposalIds retornados por present_categorization." },
        );
      }
      const categoryByTransaction = new Map<string, { category: string; categoryLabel: string }>();
      for (const proposal of selected) {
        for (const transactionId of proposal.transactionIds) {
          const existing = categoryByTransaction.get(transactionId);
          if (existing !== undefined && existing.category !== proposal.category) {
            return toolError(
              "artefato_invalido",
              "Duas propostas selecionadas atribuem categorias diferentes ao mesmo lançamento.",
              { retryable: false },
            );
          }
          categoryByTransaction.set(transactionId, {
            category: proposal.category,
            categoryLabel: proposal.categoryLabel,
          });
        }
      }
      changes = [...categoryByTransaction].map(([transactionId, category]) => ({
        transactionId,
        ...category,
      }));
      const concepts = [...new Set(selected.map((proposal) => proposal.conceptId).filter(Boolean))];
      byConceptId = concepts.length === 1 ? concepts[0] : undefined;
    } else {
      changes = input.changes;
      byConceptId = input.byConceptId;
    }

    return forTenant(
      tenantId,
      async (tx) => {
        const valid = await loadValidCategories(tx, tenantId);
        const invalid = [...new Set(changes.map((c) => c.category))].filter(
          (category) => !valid.has(category),
        );
        if (invalid.length > 0) return unknownCategory(invalid, valid);

        const ids = changes.map((change) => change.transactionId);
        // Só transações do razão de verdade: um lote ainda `proposed` se
        // corrige com `edit_proposed_batch`, não por aqui — reclassificar um
        // rascunho gravaria trilha de auditoria para algo que a pessoa ainda
        // nem confirmou.
        const rows = await tx
          .select({ id: transactions.id, category: transactions.category })
          .from(transactions)
          .where(
            and(
              eq(transactions.tenantId, tenantId),
              inArray(transactions.id, ids),
              inArray(transactions.status, ["confirmed", "adjustment"]),
            ),
          );

        const currentById = new Map(rows.map((row) => [row.id, row.category]));
        let changed = 0;
        let unchanged = 0;
        const notFound: string[] = [];

        for (const change of changes) {
          if (!currentById.has(change.transactionId)) {
            notFound.push(change.transactionId);
            continue;
          }

          const previous = currentById.get(change.transactionId) ?? null;
          if (previous === change.category) {
            unchanged += 1;
            continue;
          }

          await tx
            .update(transactions)
            .set({ category: change.category })
            .where(
              and(
                eq(transactions.id, change.transactionId),
                eq(transactions.tenantId, tenantId),
              ),
            );

          await tx.insert(transactionReclassifications).values({
            id: `rcl_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
            tenantId,
            transactionId: change.transactionId,
            field: "category",
            previousValue: previous,
            newValue: change.category,
            author: `human:${userId}`,
            reason: input.reason ?? null,
            byConceptId: byConceptId ?? null,
          });

          changed += 1;
        }

        // Zero mudanças depois de um SIM no cartão não é sucesso: a pessoa
        // aprovou algo e nada aconteceu. Na forma antiga isto voltava como
        // `{changed: 0}` sem erro — check verde no trace, indistinguível de uma
        // aprovação que mudou tudo. Erro estruturado obriga o modelo a explicar
        // e dá à interface o aviso amarelo em vez do falso verde.
        if (changed === 0) {
          return {
            ...toolError(
              "nenhuma_alteracao",
              "Nenhuma categoria foi alterada — a aprovação não teve efeito.",
              {
                hint:
                  notFound.length > 0
                    ? "Ids em notFound não existem ou ainda estão em lote proposto. Rascunho se corrige com edit_proposed_batch; confira os ids com read_batch ou com o analista."
                    : "Todas as linhas já estavam na categoria pedida. Diga isso à pessoa em vez de anunciar uma mudança.",
                retryable: true,
              },
            ),
            changed,
            unchanged,
            notFound,
          };
        }

        return {
          changed,
          unchanged,
          notFound,
          ...(notFound.length > 0
            ? {
                note: "Ids em notFound não existem OU ainda estão em lote proposto — rascunho se corrige com edit_proposed_batch.",
              }
            : {}),
          auditedBy: `human:${userId}`,
        };
      },
      db,
    );
  },
});
