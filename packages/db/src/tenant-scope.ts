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
/**
 * A RLS só protege se o papel conectado estiver SUJEITO a ela. Conectar como
 * superuser (ou papel com BYPASSRLS) não dá erro nenhum — as políticas viram
 * enfeite e toda consulta "escopada" enxerga todos os tenants. A migração
 * 0001 avisa isso em comentário; aqui o aviso vira recusa.
 *
 * Cacheia a PROMESSA, uma por processo: a verificação custa uma consulta e o
 * papel não muda no meio da vida do processo. `ALLOW_RLS_BYPASS=1` existe
 * para scripts de manutenção conscientes (reset, seed) — nunca para servir
 * requisição de usuário.
 */
const rlsChecks = new WeakMap<Database, Promise<void>>();

function ensureRlsEnforced(db: Database): Promise<void> {
  if (process.env.ALLOW_RLS_BYPASS === "1") return Promise.resolve();

  const cached = rlsChecks.get(db);
  if (cached !== undefined) return cached;

  const check = (async () => {
    const rows = (await db.execute(
      sql`select rolsuper as "rolsuper", rolbypassrls as "rolbypassrls" from pg_roles where rolname = current_user`,
    )) as unknown as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;
    const role = rows[0];
    if (role === undefined) return;
    if (role.rolsuper || role.rolbypassrls) {
      throw new Error(
        "DATABASE_URL conecta como superuser ou papel com BYPASSRLS: a RLS estaria desligada e todo dado de tenant ficaria global. Use o papel de aplicação (clara_app), ou ALLOW_RLS_BYPASS=1 para scripts de manutenção.",
      );
    }
  })().catch((error: unknown) => {
    // Falha na verificação não pode virar "deixa passar": limpa o cache para
    // reavaliar na próxima chamada e propaga.
    rlsChecks.delete(db);
    throw error;
  });

  rlsChecks.set(db, check);
  return check;
}

export async function forTenant<T>(
  tenantId: string,
  fn: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<T>,
  db: Database = getDb(),
): Promise<T> {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("forTenant requires a non-empty tenantId.");
  }

  await ensureRlsEnforced(db);

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
