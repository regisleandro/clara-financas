import "server-only";

import { getDb } from "@clara-financas/db";
import { loadCategoryLabels } from "@clara-financas/db/category-labels";
import { concepts } from "@clara-financas/db/schema/knowledge";
import { batches, documents, transactions } from "@clara-financas/db/schema/ledger";
import { needsReviewCondition, reviewReasonsFor } from "@clara-financas/db/queries/review";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { categoryLabel, categorySlug } from "@clara-financas/ledger";
import { and, asc, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { cache } from "react";

import type { ReviewQueue } from "@/lib/review-types";

export type {
  DivergentBatch,
  ReviewItem,
  ReviewQueue,
  ReviewReason,
  UnnamedDocument,
} from "@/lib/review-types";

/**
 * A fila do que a IA não resolveu.
 *
 * Existe porque a alternativa honesta ao "a Clara acerta sempre" não é esconder
 * a dúvida — é dar um lugar para ela. Três coisas entram aqui, e cada uma tem
 * um motivo diferente de estar:
 *
 *  - **Sem categoria.** O extrator leu a linha e não soube classificá-la.
 *    Enquanto isso durar, toda análise por categoria tem um buraco.
 *  - **Confiança baixa.** O extrator classificou, mas avisou que pode ter lido
 *    errado. O valor está no razão contando como gasto de qualquer forma.
 *  - **Sem comerciante.** Sobrou só a descrição crua do documento, então a
 *    linha não se agrupa com nada — nem em recorrência, nem em regra aprendida.
 *
 * Um item sai da fila quando alguém o atesta (`reviewedAt`), não quando ele
 * "parece resolvido": a maior parte das revisões termina em "a leitura estava
 * certa", e sem atestado esses itens voltariam para sempre.
 *
 * Fatura cuja soma não fechou e documento sem operadora identificada vêm em
 * listas separadas: não são linha do razão, são o documento inteiro.
 */

/**
 * Só o número, para o badge da navegação. Uma consulta, sem montar a fila.
 *
 * Embrulhado em `cache` porque o layout e a página de transações pedem o mesmo
 * número na mesma renderização — e dois números diferentes na mesma tela, se a
 * fila mudasse no meio, seria pior que um número atrasado.
 */
export const countPendingReview = cache(async (tenantId: string): Promise<number> => {
  const rows = await forTenant(tenantId, async (tx) =>
    tx
      .select({ total: count() })
      .from(transactions)
      .where(and(inArray(transactions.status, ["confirmed", "adjustment"]), needsReviewCondition())),
  );

  return rows[0]?.total ?? 0;
});

export async function loadReviewQueue(tenantId: string): Promise<ReviewQueue> {
  const db = getDb();
  const labels = await loadCategoryLabels(tenantId, db);

  return forTenant(
    tenantId,
    async (tx) => {
      const pending = await tx
        .select({
          transaction: transactions,
          issuer: documents.issuer,
          filename: documents.filename,
        })
        .from(transactions)
        .leftJoin(documents, eq(transactions.sourceDocumentId, documents.id))
        .where(and(inArray(transactions.status, ["confirmed", "adjustment"]), needsReviewCondition()))
        // Mais antigo primeiro: a fila é para ser esvaziada, e o que espera há
        // mais tempo é o que mais atrasa qualquer análise.
        .orderBy(asc(transactions.date));

      const reviewed = await tx
        .select({ total: count() })
        .from(transactions)
        .where(
          and(
            inArray(transactions.status, ["confirmed", "adjustment"]),
            isNotNull(transactions.reviewedAt),
          ),
        );

      const divergent = await tx
        .select({ batch: batches, filename: documents.filename, issuer: documents.issuer })
        .from(batches)
        .innerJoin(documents, eq(batches.documentId, documents.id))
        .where(and(eq(batches.status, "confirmed"), eq(batches.checksumResult, "mismatch")));

      // Documento sem operadora não é erro de leitura da linha, é um furo na
      // visão por operadora: todas as transações dele caem em "Sem operadora".
      const unnamed = await tx
        .select({
          id: documents.id,
          filename: documents.filename,
          entryCount: count(transactions.id),
        })
        .from(documents)
        .leftJoin(transactions, eq(transactions.sourceDocumentId, documents.id))
        .where(isNull(documents.issuer))
        .groupBy(documents.id, documents.filename)
        .orderBy(asc(documents.filename));

      const taxonomy = await tx
        .select({ conceptId: concepts.conceptId, frontmatter: concepts.frontmatter })
        .from(concepts)
        .where(eq(concepts.type, "Category"));

      const items = pending.map(({ transaction, issuer, filename }) => ({
        id: transaction.id,
        date: transaction.date,
        originalDescription: transaction.originalDescription,
        merchant: transaction.merchant,
        category: transaction.category,
        categoryLabel: categoryLabel(labels, transaction.category),
        confidence: transaction.extractionConfidence,
        amount: transaction.amount,
        page: transaction.page,
        issuer,
        filename,
        reasons: reviewReasonsFor(transaction),
      }));

      const counts = { sem_categoria: 0, confianca_baixa: 0, sem_comerciante: 0 };
      for (const item of items) {
        for (const reason of item.reasons) counts[reason] += 1;
      }

      return {
        items,
        divergentBatches: divergent.map(({ batch, filename, issuer }) => ({
          id: batch.id,
          issuer,
          filename,
          periodLabel: periodLabel(batch.periodStart, batch.periodEnd),
          difference:
            batch.declaredTotal === null || batch.extractedTotal === null
              ? null
              : batch.extractedTotal - batch.declaredTotal,
          declaredTotal: batch.declaredTotal,
          extractedTotal: batch.extractedTotal,
        })),
        unnamedDocuments: unnamed.map((document) => ({
          id: document.id,
          filename: document.filename,
          entryCount: document.entryCount,
        })),
        categories: taxonomy
          .map((concept) => {
            const slug = categorySlug(concept.conceptId);
            const title = concept.frontmatter.title;
            return { slug, label: typeof title === "string" && title !== "" ? title : slug };
          })
          .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
        counts,
        reviewedCount: reviewed[0]?.total ?? 0,
      };
    },
    db,
  );
}

function periodLabel(start: string | null, end: string | null): string | null {
  if (start === null && end === null) return null;
  const format = (iso: string) =>
    new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${iso}T12:00:00Z`));
  if (start === null) return `até ${format(end!)}`;
  if (end === null) return `de ${format(start)}`;
  return `${format(start)} – ${format(end)}`;
}
