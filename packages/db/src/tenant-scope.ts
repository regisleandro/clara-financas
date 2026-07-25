import { sql } from "drizzle-orm";

import { getDb, type Database } from "./index";

/**
 * Camadas 4 e 5 da defesa em profundidade.
 *
 * Todo acesso a dado de tenant passa por aqui. A função abre uma transação e
 * define `app.tenant_id` como variável LOCAL da transação — é esse valor que
 * as políticas RLS leem. Duas consequências que importam:
 *
 *  1. O escopo faz parte da QUERY, não é filtro aplicado depois. Mesmo um
 *     `select` sem `where` só enxerga as linhas do tenant corrente.
 *  2. `set_config(..., true)` é local à transação, então uma conexão reusada
 *     do pool nunca vaza o tenant da requisição anterior.
 *
 * Nenhuma tool monta SQL por conta própria; todas entram por aqui.
 */
export async function forTenant<T>(
  tenantId: string,
  fn: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<T>,
  db: Database = getDb(),
): Promise<T> {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("forTenant requires a non-empty tenantId.");
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * Executa como dono do schema, IGNORANDO a RLS.
 *
 * Só para migração e manutenção. Nunca em caminho servido a usuário — se você
 * está tentado a usar isto num handler, o que falta é um `forTenant`.
 */
export async function asOwner<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  return fn(getDb());
}
