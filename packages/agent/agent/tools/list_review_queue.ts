import { getDb } from "@clara-financas/db";
import {
  needsReviewCondition,
  reviewFlagsCondition,
  reviewReasonsFor,
  uncategorizedSpendCondition,
} from "@clara-financas/db/queries/review";
import { documents, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { formatCents } from "@clara-financas/ledger";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
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
 *
 * E é por aqui que a conversa VÊ os lançamentos sem categoria, um a um. O estado
 * do razão diz quantos são; só esta tool diz quais são, com data, descrição,
 * valor e id. Sem esse caminho escrito, "apresente esses itens" virava uma
 * delegação ao guarda-livros — que triagem faz, apresentação não — e a resposta
 * terminava em "a consulta não retornou os dados".
 */
export default defineTool({
  description:
    "Lists the entries still waiting for human review — no category, low extraction confidence, or no merchant — oldest first. THIS is how you show WHICH entries are uncategorised: the ledger state only says how many. Each entry carries date, description, merchant, value and id, plus why it is in the queue. Filter with reasons: ['sem_categoria']. If it returns nothing while the state says there is uncategorised spending, those entries were already attested — repeat with includeReviewed: true. mark_reviewed takes an entry out of the queue.",
  inputSchema: z.object({
    reasons: z
      .array(z.enum(["sem_categoria", "confianca_baixa", "sem_comerciante"]))
      .optional()
      .describe("Keep only entries flagged for these reasons."),
    batchId: z.string().min(1).optional().describe("Restrict to one invoice."),
    includeReviewed: z
      .boolean()
      .optional()
      .describe(
        "Also list entries a person already attested that still carry the flag. Use when the queue comes back empty and the ledger state says there is uncategorised spending: an attested entry with no category counts there and does not wait in the queue.",
      ),
    limit: z.number().int().min(1).max(LIMIT).optional(),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    // Fora da transação: `loadCategoryLabels` abre a sua própria, e o pool é
    // de uma conexão só.
    const labels = await loadCategoryLabels(tenantId);
    const includeReviewed = input.includeReviewed === true;

    const found = await forTenant(
      tenantId,
      async (tx) => {
        const recorded = [
          eq(transactions.tenantId, tenantId),
          inArray(transactions.status, ["confirmed", "adjustment"] as const),
          ...(input.batchId === undefined ? [] : [eq(transactions.batchId, input.batchId)]),
        ];
        // O recorte listado pode incluir o atestado; a CONTA da fila nunca —
        // "quantos esperam revisão" é sempre o que ninguém olhou ainda, senão
        // pedir o atestado junto inflaria o número que a tela mostra no badge.
        const scope = and(
          ...recorded,
          includeReviewed ? reviewFlagsCondition() : needsReviewCondition(),
        );

        const [total] = await tx
          .select({ total: count() })
          .from(transactions)
          .where(and(...recorded, needsReviewCondition()));
        const [matched] = await tx.select({ total: count() }).from(transactions).where(scope);

        // O mesmo recorte do estado do razão, pelo predicado compartilhado: é o
        // que permite dizer "os 2 sem categoria já foram atestados" em vez de
        // "não há nada", que contradiz o bloco lido no início do turno.
        const [spend] = await tx
          .select({
            count: count(),
            totalCents: sql<number>`coalesce(sum(${transactions.amount}), 0)::int`,
          })
          .from(transactions)
          .where(and(...recorded, uncategorizedSpendCondition()));

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

        return {
          pending: total?.total ?? 0,
          matched: matched?.total ?? 0,
          uncategorizedSpending: {
            count: spend?.count ?? 0,
            totalCents: spend?.totalCents ?? 0,
          },
          rows,
        };
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

    const uncategorized = found.uncategorizedSpending;
    // Um objeto só, usado nas duas saídas: quando a resposta vazia omitia o
    // indicador, era exatamente nela que ele mais fazia falta.
    const uncategorizedSpending = {
      ...uncategorized,
      totalFormatted: formatCents(uncategorized.totalCents),
      // Com `batchId` a conta é DAQUELA fatura, e o número do estado do razão é
      // do razão inteiro: sem dizer o escopo, dois totais legítimos pareceriam
      // uma contradição.
      scope: input.batchId === undefined ? ("ledger" as const) : ("invoice" as const),
    };
    // Vazio com gasto sem categoria do outro lado NÃO é "não há nada": é item
    // atestado, e a saída é uma chamada, não um pedido de desculpa. Dizer isso
    // aqui é o que impede a resposta de contradizer o estado do razão.
    const attestedOnly =
      items.length === 0 &&
      !includeReviewed &&
      uncategorized.count > 0 &&
      (input.reasons === undefined || input.reasons.includes("sem_categoria"));

    if (items.length === 0) {
      return {
        pending: found.pending,
        returned: 0,
        items: [],
        uncategorizedSpending,
        ...(attestedOnly ? { retryWith: { includeReviewed: true } } : {}),
        message: attestedOnly
          ? `A fila não tem esses itens porque uma pessoa já os atestou, mas ${uncategorized.count} ${uncategorized.count === 1 ? "lançamento continua" : "lançamentos continuam"} sem categoria (${formatCents(uncategorized.totalCents)}). Repita esta chamada com includeReviewed: true para listá-los; não responda que a consulta voltou vazia.`
          : found.pending === 0
            ? "Não há nada esperando revisão."
            : "Nenhum item com esses motivos, embora a fila não esteja vazia.",
      };
    }

    return {
      pending: found.pending,
      returned: items.length,
      // Truncou quando o LIMITE cortou linhas, não quando o filtro de motivo
      // descartou algumas: comparar com `pending` marcava como truncada toda
      // consulta filtrada, e o modelo avisava de um resto que não existe.
      truncated: found.matched > found.rows.length,
      items,
      // O indicador do estado do razão, na mesma resposta: é contra ele que a
      // pessoa pergunta ("existem itens sem categoria?"), e ver os dois juntos
      // impede a Clara de apresentar uma lista parcial como se fosse o total.
      uncategorizedSpending,
      note: "Um item sai da fila com mark_reviewed, mesmo quando a leitura já estava certa — é o atestado que impede a fila de devolvê-lo para sempre.",
    };
  },
});
