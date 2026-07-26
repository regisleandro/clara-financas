import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import postgres from "postgres";

/**
 * Baseline do journal de migrações, para um banco que nasceu de `db:push`.
 *
 * O cenário que motivou isto (visto em produção): as tabelas todas existem,
 * mas `drizzle.__drizzle_migrations` está vazio — o schema foi criado com
 * `db:push`, que não registra journal. O `db:migrate` então tenta rodar a
 * migração 0000 do zero e morre em "relation already exists", para sempre.
 *
 * O baseline REGISTRA as migrações antigas como aplicadas, sem executá-las,
 * até a tag indicada — deixando as posteriores para o `db:migrate` aplicar de
 * verdade. É uma declaração ("este banco já está no estado da tag X"), então
 * o modo padrão é um RELATÓRIO do estado real — tabelas, RLS, políticas,
 * triggers — para conferir a declaração antes de fazê-la. Atenção ao ponto
 * cego: `db:push` NÃO cria o que só existe nas migrações manuais (políticas
 * de RLS, triggers de imutabilidade). Se o relatório mostrar isso faltando,
 * baseline seria mentira — o que falta precisa ser aplicado antes.
 *
 * Uso:
 *   pnpm -F @clara-financas/db db:baseline                     # só relatório
 *   pnpm -F @clara-financas/db db:baseline --apply --through 0013_demonic_bromley
 */

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(here, "../../../apps/web/.env"), quiet: true });

const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL || "";
if (url === "") {
  console.error("DATABASE_ADMIN_URL não definida (nem DATABASE_URL).");
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const throughIndex = args.indexOf("--through");
const through = throughIndex === -1 ? null : (args[throughIndex + 1] ?? null);

const migrationsFolder = join(here, "migrations");
const journal = JSON.parse(
  readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
) as { entries: Array<{ tag: string; when: number }> };

const client = postgres(url, { max: 1, onnotice: () => {} });

try {
  // ---------- Relatório: o que este banco de fato contém ----------
  const [db] = await client<[{ db: string; usr: string }]>`
    select current_database() as db, current_user as usr
  `;
  console.log(`Banco: ${db?.db} · papel: ${db?.usr}\n`);

  const journalRows = await client<Array<{ count: string }>>`
    select count(*)::text as count from drizzle.__drizzle_migrations
  `.catch(() => [{ count: "(sem tabela de journal)" }]);
  console.log(`Migrações registradas no journal do banco: ${journalRows[0]?.count}`);
  console.log(
    `Journal local: ${journal.entries.length} (até ${journal.entries.at(-1)?.tag})\n`,
  );

  const tables = await client<
    Array<{ name: string; rls: boolean; forced: boolean; policies: string }>
  >`
    select c.relname as name,
           c.relrowsecurity as rls,
           c.relforcerowsecurity as forced,
           (select count(*)::text from pg_policy p where p.polrelid = c.oid) as policies
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  `;
  console.log("Tabelas em public (RLS ativa? · forçada? · nº de políticas):");
  for (const table of tables) {
    console.log(
      `  ${table.name.padEnd(32)} rls=${table.rls ? "sim" : "NÃO"} forced=${
        table.forced ? "sim" : "NÃO"
      } políticas=${table.policies}`,
    );
  }

  const triggers = await client<Array<{ table: string; name: string }>>`
    select c.relname as table, t.tgname as name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
    order by 1, 2
  `;
  console.log(
    `\nTriggers: ${
      triggers.length === 0
        ? "NENHUM (os de imutabilidade do razão viriam das migrações 0003/0004)"
        : triggers.map((trigger) => `${trigger.table}.${trigger.name}`).join(", ")
    }`,
  );

  const missingSecurity = tables.filter(
    (table) => table.name !== "provisioning_jobs" && (!table.rls || table.policies === "0"),
  );
  if (missingSecurity.length > 0) {
    console.log(
      "\n⚠ Tabelas sem RLS ou sem política: " +
        missingSecurity.map((table) => table.name).join(", ") +
        "\n  Se forem tabelas de tenant, as migrações manuais de segurança nunca" +
        "\n  rodaram neste banco — fazer baseline delas seria registrar como" +
        "\n  aplicado algo que não está. Resolva isso antes do --apply.",
    );
  }

  // ---------- Aplicação ----------
  if (!apply) {
    console.log(
      "\nRelatório apenas — nada foi alterado. Para registrar o baseline:\n" +
        "  pnpm -F @clara-financas/db db:baseline --apply --through <tag>\n" +
        "(a tag é a última migração cujo estado este banco JÁ tem; as" +
        " posteriores serão aplicadas pelo db:migrate)",
    );
    process.exit(0);
  }

  if (through === null) {
    console.error("\n--apply exige --through <tag>. Nada foi alterado.");
    process.exit(1);
  }
  const cutoff = journal.entries.findIndex((entry) => entry.tag === through);
  if (cutoff === -1) {
    console.error(`\nTag desconhecida: ${through}. Nada foi alterado.`);
    process.exit(1);
  }

  const existing = Number(
    (await client<[{ count: string }]>`
      select count(*)::text as count from drizzle.__drizzle_migrations
    `.catch(() => [{ count: "0" }]))[0]?.count ?? "0",
  );
  if (Number.isNaN(existing) || existing > 0) {
    console.error(
      "\nO journal do banco NÃO está vazio — baseline é só para journal zerado." +
        " Um journal parcial pede diagnóstico manual. Nada foi alterado.",
    );
    process.exit(1);
  }

  await client`create schema if not exists drizzle`;
  await client`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `;

  const entries = journal.entries.slice(0, cutoff + 1);
  // O migrator decide "já aplicada" comparando o created_at (o `when` do
  // journal) da última linha; o hash (sha256 do arquivo) fica de registro.
  await client.begin(async (tx) => {
    for (const entry of entries) {
      const sqlText = readFileSync(join(migrationsFolder, `${entry.tag}.sql`), "utf8");
      const hash = createHash("sha256").update(sqlText).digest("hex");
      await tx`
        insert into drizzle.__drizzle_migrations (hash, created_at)
        values (${hash}, ${entry.when})
      `;
    }
  });

  console.log(
    `\nBaseline registrado: ${entries.length} migrações marcadas como aplicadas` +
      ` (até ${through}). Rode agora o db:migrate para aplicar as restantes (${
        journal.entries.length - entries.length
      }).`,
  );
} catch (error) {
  console.error("\nFalha ao consultar o banco:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
