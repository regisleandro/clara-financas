import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Runner de migração com erro LEGÍVEL.
 *
 * Substitui o `drizzle-kit migrate` no script `db:migrate` porque, quando uma
 * migração falha, o drizzle-kit sai com código 1 sem imprimir o erro do
 * Postgres — no CI o log termina em "applying migrations..." e ninguém sabe
 * qual statement quebrou nem por quê. Aconteceu na primeira execução real do
 * workflow, e diagnosticar exigiu adivinhação.
 *
 * Aqui o erro sai inteiro: código, mensagem, detail/hint do Postgres e a
 * query que falhou. Antes de aplicar, também imprime o placar journal local ×
 * banco — que denuncia na hora o cenário "tabelas existem mas o journal está
 * vazio" (banco criado com db:push, não com migrate).
 *
 * Mesmas convenções do drizzle-kit: pasta `src/migrations`, tabela
 * `drizzle.__drizzle_migrations`, credencial de DONO (`DATABASE_ADMIN_URL`,
 * com queda para `DATABASE_URL`), e o `.env` do app para uso local.
 */

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(here, "../../../apps/web/.env"), quiet: true });

const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL || "";
if (url === "") {
  console.error(
    "DATABASE_ADMIN_URL não definida (nem DATABASE_URL). A migração roda como dono do schema.",
  );
  process.exit(1);
}

const migrationsFolder = join(here, "migrations");
const journal = JSON.parse(
  readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
) as { entries: Array<{ tag: string }> };

const client = postgres(url, {
  max: 1,
  // NOTICEs ("already exists, skipping") são ruído esperado do bootstrap do
  // journal; o que importa aparece como erro de verdade.
  onnotice: () => {},
});

try {
  const [row] = await client<[{ count: string }?]>`
    select count(*)::text as count
    from drizzle.__drizzle_migrations
  `.catch(() => []);
  const applied = row === undefined ? 0 : Number(row.count);
  console.log(
    `Journal local: ${journal.entries.length} migrações (até ${journal.entries.at(-1)?.tag}). ` +
      `Registradas no banco: ${applied}.`,
  );

  await migrate(drizzle(client), { migrationsFolder });
  console.log("Migrações aplicadas com sucesso.");
} catch (error) {
  console.error("\nA migração FALHOU. Erro completo do banco:\n");
  if (error instanceof Error) {
    const pg = error as Error & {
      code?: string;
      detail?: string;
      hint?: string;
      where?: string;
      query?: string;
    };
    console.error(`mensagem : ${pg.message}`);
    if (pg.code !== undefined) console.error(`código   : ${pg.code}`);
    if (pg.detail !== undefined) console.error(`detail   : ${pg.detail}`);
    if (pg.hint !== undefined) console.error(`hint     : ${pg.hint}`);
    if (pg.where !== undefined) console.error(`where    : ${pg.where}`);
    if (pg.query !== undefined) console.error(`\nstatement que falhou:\n${pg.query}`);
    // Falha de CONEXÃO (host errado, DNS, TLS) chega embrulhada: a causa raiz
    // fica em `cause`, não na mensagem.
    if (pg.cause !== undefined) console.error(`\ncausa raiz: ${String(pg.cause)}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
