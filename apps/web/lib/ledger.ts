import "server-only";

import { getDb } from "@clara-financas/db";
import { concepts, conceptRevisions } from "@clara-financas/db/schema/knowledge";
import { documents, transactions } from "@clara-financas/db/schema/ledger";
import { transactionReclassifications } from "@clara-financas/db/schema/reclassification";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { aggregateByCategory, totalSpend, type Transaction } from "@clara-financas/ledger";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
} from "drizzle-orm";

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

export const TRANSACTION_PAGE_SIZE = 50;

export type LedgerPageOptions = {
  page?: number;
  pageSize?: number;
  query?: string;
  category?: string;
};

const toLedgerRow = ({
  transaction,
  documentFilename,
  documentIssuer,
}: {
  transaction: typeof transactions.$inferSelect;
  documentFilename: string | null;
  documentIssuer: string | null;
}): LedgerRow => ({
  id: transaction.id,
  date: transaction.date,
  originalDescription: transaction.originalDescription,
  merchant: transaction.merchant,
  merchantKey: transaction.merchantKey,
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
});

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

  const ledger: LedgerRow[] = rows.map(toLedgerRow);

  return {
    rows: ledger,
    total: totalSpend(ledger),
    categories: aggregateByCategory(ledger),
  };
}

/**
 * Página da lista operacional do razão.
 *
 * A lista não precisa carregar o razão inteiro para exibir 50 linhas. Busca,
 * categoria, total e categorias disponíveis são resolvidos no banco, então o
 * filtro continua correto sem transferir milhares de lançamentos para o
 * navegador.
 */
export async function loadLedgerPage(
  tenantId: string,
  options: LedgerPageOptions = {},
) {
  const db = getDb();
  const pageSize = Math.min(Math.max(Math.trunc(options.pageSize ?? TRANSACTION_PAGE_SIZE), 10), 100);
  const page = Math.max(Math.trunc(options.page ?? 1), 1);
  const query = options.query?.trim().slice(0, 120) ?? "";
  const category = options.category?.trim() ?? "";

  const filters = [
    inArray(transactions.status, ["confirmed", "adjustment"]),
    query === ""
      ? undefined
      : or(
          ilike(transactions.merchant, `%${query}%`),
          ilike(transactions.originalDescription, `%${query}%`),
        ),
    category === ""
      ? undefined
      : category === "Sem categoria"
        ? isNull(transactions.category)
        : eq(transactions.category, category),
  ].filter((filter): filter is NonNullable<typeof filter> => filter !== undefined);
  const where = and(...filters);

  const result = await forTenant(
    tenantId,
    async (tx) => {
      const countResult = await tx
        .select({ total: count() })
        .from(transactions)
        .where(where);
      const total = countResult[0]?.total ?? 0;
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const currentPage = Math.min(page, pageCount);
      const rows = await tx
        .select({
          transaction: transactions,
          documentFilename: documents.filename,
          documentIssuer: documents.issuer,
        })
        .from(transactions)
        .leftJoin(documents, eq(transactions.sourceDocumentId, documents.id))
        .where(where)
        .orderBy(desc(transactions.date), desc(transactions.id))
        .limit(pageSize)
        .offset((currentPage - 1) * pageSize);

      const categoryRows = await tx
        .select({ category: transactions.category })
        .from(transactions)
        .where(inArray(transactions.status, ["confirmed", "adjustment"]))
        .groupBy(transactions.category)
        .orderBy(asc(transactions.category));

      return {
        rows: rows.map(toLedgerRow),
        total,
        currentPage,
        pageCount,
        categories: categoryRows
          .map((row) => row.category)
          .filter((value): value is string => value !== null),
      };
    },
    db,
  );

  return {
    ...result,
    pageSize,
    page: result.currentPage,
    query,
    category: category === "" ? undefined : category,
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
