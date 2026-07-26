import { getDb } from "@clara-financas/db";
import { needsReviewCondition, reviewReasonsFor } from "@clara-financas/db/queries/review";
import { documents, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { formatCents } from "@clara-financas/ledger";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { categoryLabel, loadCategoryLabels } from "../lib/categories";
import { requireTenantCaller } from "../lib/tenant";

const LIMIT = 100;

/**
 * A fila do que a extração não fechou, agora alcançável pela conversa.
 *
 * Ela existia só na tela `/revisar`, atrás de `server-only` — e a consequência
 * era direta: perguntar "o que está para revisar sem categoria" não tinha
 * resposta. A informação estava a um clique de distância, na aba ao lado, e a
 * Clara dizia que não sabia.
 *
 * O predicado é o MESMO da tela (`@clara-financas/db/queries/review`), não uma
 * cópia: fila e conversa divergirem seria pior que a conversa não ter fila.
 */
export default defineTool({
  description:
    "Lists the entries still waiting for human review — no category, low extraction confidence, or no merchant — oldest first. Use when the person asks what is pending, what needs checking, or what the extraction could not close. Each entry says why it is in the queue; mark_reviewed takes it out.",
  inputSchema: z.object({
    reasons: z
      .array(z.enum(["sem_categoria", "confianca_baixa", "sem_comerciante"]))
      .optional()
      .describe("Keep only entries flagged for these reasons."),
    batchId: z.string().min(1).optional().describe("Restrict to one invoice."),
    limit: z.number().int().min(1).max(LIMIT).optional(),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    // Fora da transação: `loadCategoryLabels` abre a sua própria, e o pool é
    // de uma conexão só.
    const labels = await loadCategoryLabels(tenantId);

    const found = await forTenant(
      tenantId,
      async (tx) => {
        const scope = and(
          eq(transactions.tenantId, tenantId),
          inArray(transactions.status, ["confirmed", "adjustment"]),
          needsReviewCondition(),
          ...(input.batchId === undefined ? [] : [eq(transactions.batchId, input.batchId)]),
        );

        const [total] = await tx.select({ total: count() }).from(transactions).where(scope);

        const rows = await tx
          .select({
            transaction: transactions,
            issuer: documents.issuer,
          })
          .from(transactions)
          .leftJoin(documents, eq(transactions.sourceDocumentId, documents.id))
          .where(scope)
          // Mais antigo primeiro: a fila é para ser esvaziada, e o que espera
          // há mais tempo é o que mais atrasa qualquer análise.
          .orderBy(asc(transactions.date))
          .limit(input.limit ?? LIMIT);

        return { pending: total?.total ?? 0, rows };
      },
      getDb(),
    );

    const wanted = input.reasons;
    const items = found.rows
      .map(({ transaction, issuer }) => ({
        id: transaction.id,
        date: transaction.date,
        // A descrição CRUA, e não o palpite da Clara: é contra ela que a
        // pessoa confere, e trocá-la transformaria a revisão em adivinhação
        // sobre a própria leitura que está sob suspeita.
        description: transaction.originalDescription,
        merchant: transaction.merchant,
        amountCents: transaction.amount,
        amountFormatted: formatCents(transaction.amount),
        kind: transaction.kind,
        category: transaction.category,
        categoryLabel: categoryLabel(labels, transaction.category),
        confidence: transaction.extractionConfidence,
        batchId: transaction.batchId,
        issuer,
        reasons: reviewReasonsFor(transaction),
      }))
      .filter(
        (item) => wanted === undefined || item.reasons.some((reason) => wanted.includes(reason)),
      );

    if (items.length === 0) {
      return {
        pending: found.pending,
        returned: 0,
        items: [],
        message:
          found.pending === 0
            ? "Não há nada esperando revisão."
            : "Nenhum item com esses motivos, embora a fila não esteja vazia.",
      };
    }

    return {
      pending: found.pending,
      returned: items.length,
      truncated: found.pending > items.length,
      items,
      note: "Um item sai da fila com mark_reviewed, mesmo quando a leitura já estava certa — é o atestado que impede a fila de devolvê-lo para sempre.",
    };
  },
});
