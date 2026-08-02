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
 * A leitura é escopada pelo tenant como qualquer outra. O teto é de PÁGINA, não
 * do pedido: ele existe para não trazer milhares de linhas de uma vez, e não
 * para recusar quem tem muitas.
 *
 * A distinção custou caro. O teto era aplicado como limite do pedido, então uma
 * categoria com 120 lançamentos devolvia 400 e a tela dizia "não consegui abrir
 * os lançamentos agora" — a conferência falhava exatamente onde o número era
 * maior e a vontade de conferir, também.
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
  /** Início da página, para conferir linhas com mais de `PROVENANCE_LIMIT` ids. */
  offset = 0,
): Promise<ProvenanceEntry[]> {
  const wanted = [...new Set(ids)].slice(offset, offset + PROVENANCE_LIMIT);
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
