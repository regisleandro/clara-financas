import { env } from "@clara-financas/env/database";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * Conexão com o banco do control plane.
 *
 * Em serverless cada instância abre poucas conexões — daí `max: 1`, com o
 * pooler do provedor à frente. O banco de cada TENANT usará outra função,
 * `forTenant()`, resolvendo a credencial pelo registry (Etapa 4).
 */
/**
 * Cria a conexão e devolve também o client, para quem precisa encerrá-la.
 * Testes e scripts precisam disso: sem `client.end()` o processo não sai.
 */
export function createDbClient(connectionString?: string) {
  const client = postgres(connectionString ?? env.DATABASE_URL, { max: 1 });
  return { db: drizzle({ client, schema }), client };
}

export function createDb(connectionString?: string) {
  return createDbClient(connectionString).db;
}

export type Database = ReturnType<typeof createDb>;

/**
 * Singleton preguiçoso: conectar no escopo do módulo faria o build do Next
 * exigir DATABASE_URL em tempo de import, antes de existir qualquer
 * requisição.
 */
let cached: Database | null = null;

export function getDb(): Database {
  cached ??= createDb();
  return cached;
}

export { schema };
