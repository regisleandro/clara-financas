import "server-only";

import { getDb } from "@clara-financas/db";
import { concepts, conceptRevisions } from "@clara-financas/db/schema/knowledge";
import { documents, transactions } from "@clara-financas/db/schema/ledger";
import { transactionReclassifications } from "@clara-financas/db/schema/reclassification";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { aggregateByCategory, totalSpend, type Transaction } from "@clara-financas/ledger";
import { desc, eq, inArray } from "drizzle-orm";

/**
 * Leitura do razão para as telas.
 *
 * Reusa as MESMAS funções de agregação que o analista usa
 * (`@clara-financas/ledger`). Se a tela calculasse por conta própria, dois
 * caminhos poderiam divergir e a pessoa veria um número no painel e outro na
 * conversa — que é justamente o tipo de coisa que destrói confiança num
 * assistente financeiro.
 */

export type LedgerRow = Transaction & {
  documentFilename: string | null;
  documentIssuer: string | null;
  status: string;
};

export async function loadLedgerView(tenantId: string) {
  const db = getDb();

  const rows = await forTenant(
    tenantId,
    async (tx) =>
      tx
        .select({
          transaction: transactions,
          documentFilename: documents.filename,
          documentIssuer: documents.issuer,
        })
        .from(transactions)
        .leftJoin(documents, eq(transactions.sourceDocumentId, documents.id))
        .where(inArray(transactions.status, ["confirmed", "adjustment"]))
        .orderBy(desc(transactions.date)),
    db,
  );

  const ledger: LedgerRow[] = rows.map(({ transaction, documentFilename, documentIssuer }) => ({
    id: transaction.id,
    date: transaction.date,
    originalDescription: transaction.originalDescription,
    merchant: transaction.merchant,
    amount: transaction.amount,
    kind: transaction.kind,
    installment:
      transaction.installmentCurrent !== null && transaction.installmentTotal !== null
        ? { current: transaction.installmentCurrent, total: transaction.installmentTotal }
        : null,
    category: transaction.category,
    extractionConfidence: transaction.extractionConfidence,
    sourceDocument: transaction.sourceDocumentId,
    page: transaction.page,
    documentFilename,
    documentIssuer,
    status: transaction.status,
  }));

  return {
    rows: ledger,
    total: totalSpend(ledger),
    categories: aggregateByCategory(ledger),
  };
}

export type LearnedConcept = {
  conceptId: string;
  type: string;
  title: string;
  description: string | null;
  body: string;
  updatedAt: Date;
  verifiedBy: string | null;
  revisionCount: number;
};

/** Conceitos do bundle `learnings` — o que a Clara aprendeu sobre a pessoa. */
export async function loadLearnings(tenantId: string): Promise<LearnedConcept[]> {
  const db = getDb();

  return forTenant(
    tenantId,
    async (tx) => {
      const rows = await tx
        .select()
        .from(concepts)
        .where(eq(concepts.bundle, "learnings"))
        .orderBy(desc(concepts.updatedAt));

      if (rows.length === 0) return [];

      const revisions = await tx
        .select({ conceptRowId: conceptRevisions.conceptRowId })
        .from(conceptRevisions)
        .where(
          inArray(
            conceptRevisions.conceptRowId,
            rows.map((row) => row.id),
          ),
        );

      const counts = new Map<string, number>();
      for (const revision of revisions) {
        counts.set(revision.conceptRowId, (counts.get(revision.conceptRowId) ?? 0) + 1);
      }

      return rows.map((row) => {
        const verified = row.frontmatter.verified;
        const last = Array.isArray(verified) ? verified[verified.length - 1] : undefined;
        return {
          conceptId: row.conceptId,
          type: row.type,
          title: row.frontmatter.title ?? row.conceptId,
          description: row.frontmatter.description ?? null,
          body: row.body,
          updatedAt: row.updatedAt,
          verifiedBy: last?.by ?? null,
          revisionCount: counts.get(row.id) ?? 0,
        };
      });
    },
    db,
  );
}

export type ReclassificationEntry = {
  id: string;
  transactionId: string;
  description: string;
  previousValue: string | null;
  newValue: string | null;
  author: string;
  reason: string | null;
  createdAt: Date;
};

/**
 * Trilha de recategorização — o histórico visível que substituiu o `git log`.
 *
 * A hipótese H3 pede conhecimento versionado e reversível. Sem esta tela, o
 * histórico existiria no banco e não na vida da pessoa, o que não prova nada.
 */
export async function loadReclassifications(
  tenantId: string,
  limit = 50,
): Promise<ReclassificationEntry[]> {
  const db = getDb();

  return forTenant(
    tenantId,
    async (tx) => {
      const rows = await tx
        .select({
          entry: transactionReclassifications,
          description: transactions.originalDescription,
        })
        .from(transactionReclassifications)
        .leftJoin(
          transactions,
          eq(transactionReclassifications.transactionId, transactions.id),
        )
        .orderBy(desc(transactionReclassifications.createdAt))
        .limit(limit);

      return rows.map(({ entry, description }) => ({
        id: entry.id,
        transactionId: entry.transactionId,
        description: description ?? "(transação removida)",
        previousValue: entry.previousValue,
        newValue: entry.newValue,
        author: entry.author,
        reason: entry.reason,
        createdAt: entry.createdAt,
      }));
    },
    db,
  );
}
