import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb, type Database } from "../index";
import { documents, transactions } from "../schema/ledger";
import { forTenant } from "../tenant-scope";

/**
 * Os lançamentos por trás de um número.
 *
 * Todo painel já carrega os `transactionIds` de cada linha — a proveniência é
 * exigida pelo contrato e recusada quando falta. Só que ninguém conseguia
 * VER esses lançamentos: os ids chegavam à interface e morriam ali. "Todo
 * número deve poder ser conferido" era verdade no dado e mentira na tela.
 *
 * A leitura é escopada pelo tenant como qualquer outra, e o teto existe porque
 * uma linha de painel representa dezenas de lançamentos, não milhares.
 */
export const PROVENANCE_LIMIT = 100;

export type ProvenanceEntry = {
  id: string;
  date: string;
  description: string;
  merchant: string | null;
  amountCents: number;
  kind: string;
  category: string | null;
  issuer: string | null;
};

export async function loadTransactionsByIds(
  tenantId: string,
  ids: readonly string[],
  db: Database = getDb(),
): Promise<ProvenanceEntry[]> {
  const wanted = [...new Set(ids)].slice(0, PROVENANCE_LIMIT);
  if (wanted.length === 0) return [];

  return forTenant(
    tenantId,
    async (tx) =>
      tx
        .select({
          id: transactions.id,
          date: transactions.date,
          // A descrição CRUA do documento: é contra ela que se confere. O
          // palpite do extrator (`merchant`) vai junto, mas não no lugar dela.
          description: transactions.originalDescription,
          merchant: transactions.merchant,
          amountCents: transactions.amount,
          kind: transactions.kind,
          category: transactions.category,
          issuer: documents.issuer,
        })
        .from(transactions)
        .leftJoin(documents, eq(transactions.sourceDocumentId, documents.id))
        .where(and(eq(transactions.tenantId, tenantId), inArray(transactions.id, wanted)))
        .orderBy(asc(transactions.date), asc(transactions.id)),
    db,
  );
}
