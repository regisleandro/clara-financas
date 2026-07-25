import { getDb } from "@clara-financas/db";
import { transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import type { Transaction } from "@clara-financas/ledger";
import { and, gte, inArray, lte, sql, type SQL } from "drizzle-orm";

import { categoryLabel, type CategoryLabels } from "../../../lib/categories";

/**
 * Carrega transações CONFIRMADAS do razão, no escopo do tenant.
 *
 * Rascunhos (`proposed`) ficam de fora de propósito: análise sobre lote não
 * aprovado apresentaria como fato algo que a pessoa ainda não confirmou.
 */
export async function loadLedger(
  tenantId: string,
  range: { from?: string; to?: string } = {},
): Promise<Transaction[]> {
  const filters: SQL[] = [inArray(transactions.status, ["confirmed", "adjustment"])];
  if (range.from !== undefined) filters.push(gte(transactions.date, range.from));
  if (range.to !== undefined) filters.push(lte(transactions.date, range.to));

  const rows = await forTenant(
    tenantId,
    async (tx) => tx.select().from(transactions).where(and(...filters)),
    getDb(),
  );

  return rows.map(toDomain);
}

/**
 * Que períodos o razão de fato cobre.
 *
 * Serve para responder vazio de forma útil. Um recorte sem dados é ambíguo: o
 * razão está vazio, ou a pergunta pegou o mês errado? Sem essa informação o
 * modelo conclui "não há nada registrado" e manda a pessoa reenviar uma fatura
 * que já está lá — observado na prática, quando ele filtrou por julho e as
 * transações eram do ciclo 31/05–30/06.
 */
export async function ledgerCoverage(
  tenantId: string,
): Promise<{ count: number; firstDate: string | null; lastDate: string | null }> {
  const rows = await forTenant(
    tenantId,
    async (tx) =>
      tx
        .select({
          count: sql<number>`count(*)::int`,
          firstDate: sql<string | null>`min(${transactions.date})`,
          lastDate: sql<string | null>`max(${transactions.date})`,
        })
        .from(transactions)
        .where(inArray(transactions.status, ["confirmed", "adjustment"])),
    getDb(),
  );

  return rows[0] ?? { count: 0, firstDate: null, lastDate: null };
}

/** Traduz a linha do banco para o tipo do domínio, que é o que o ledger usa. */
export function toDomain(row: typeof transactions.$inferSelect): Transaction {
  return {
    id: row.id,
    date: row.date,
    originalDescription: row.originalDescription,
    merchant: row.merchant,
    amount: row.amount,
    kind: row.kind,
    installment:
      row.installmentCurrent !== null && row.installmentTotal !== null
        ? { current: row.installmentCurrent, total: row.installmentTotal }
        : null,
    category: row.category,
    extractionConfidence: row.extractionConfidence,
    sourceDocument: row.sourceDocumentId,
    page: row.page,
  };
}

/**
 * Resumo enviado ao modelo para uma transação.
 *
 * Deliberadamente enxuto: mandar a linha inteira gastaria contexto e faria o
 * modelo repetir dado em vez de referenciar por id.
 */
export function brief(transaction: Transaction, labels: CategoryLabels = {}) {
  return {
    id: transaction.id,
    date: transaction.date,
    description: transaction.originalDescription,
    merchant: transaction.merchant,
    amountCents: transaction.amount,
    category: transaction.category,
    // O rótulo vai junto para o modelo escrever "Restaurantes" e não "dining".
    categoryLabel: categoryLabel(labels, transaction.category),
    page: transaction.page,
  };
}
