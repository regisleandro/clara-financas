/**
 * Zera o razão para recomeçar os testes, preservando identidade e contrato.
 *
 * O que SAI: documentos, lotes, transações, reclassificações, compromissos,
 * notificações, sessões do agente e tudo que estava no bundle `learnings`.
 * O que FICA: usuários, sessões de login, tenants e a `constitution`.
 *
 * Por que `TRUNCATE` e não `DELETE`: o trigger `clara_transactions_immutable`
 * recusa apagar transação confirmada — é a garantia que sustenta a hipótese H5
 * e não deve ser afrouxada nem para limpar. `TRUNCATE` não dispara trigger de
 * linha, então o registro contábil continua imutável pelo caminho normal e
 * ainda assim existe um jeito explícito, auditável e de propriedade do dono do
 * schema de recomeçar do zero.
 *
 * Roda com DATABASE_ADMIN_URL (papel de migração). O papel de aplicação não
 * pode truncar, e é assim que tem de ser.
 *
 * Uso:
 *   pnpm db:reset            # pede confirmação
 *   pnpm db:reset --yes      # sem perguntar
 */
import { createInterface } from "node:readline/promises";
import { rm } from "node:fs/promises";
import { stdin, stdout } from "node:process";

import postgres from "postgres";

const BLOB_DIR = new URL("../.data/documents", import.meta.url);

/**
 * Ordem não importa para `TRUNCATE ... CASCADE`, mas listar tudo
 * explicitamente importa: uma tabela nova que também guarde dado de teste
 * precisa aparecer aqui, e uma lista explícita é o que torna a omissão
 * visível numa revisão.
 */
const TRUNCATE = [
  "transactions",
  "batches",
  "documents",
  "transaction_reclassifications",
  "commitments",
  "notifications",
  "agent_sessions",
];

async function main() {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error(
      "DATABASE_ADMIN_URL não definida. Este script trunca tabelas; exige o papel de migração.",
    );
  }

  const confirmed = process.argv.includes("--yes");
  if (!confirmed) {
    const readline = createInterface({ input: stdin, output: stdout });
    const answer = await readline.question(
      `Isto APAGA o razão inteiro de ${redact(url)} (documentos, faturas, transações,\n` +
        "compromissos e aprendizados). Login, tenants e constituição ficam.\n" +
        "Digite 'apagar' para confirmar: ",
    );
    readline.close();
    if (answer.trim() !== "apagar") {
      console.log("Cancelado. Nada foi apagado.");
      return;
    }
  }

  const sql = postgres(url, { max: 1 });

  try {
    const before = await counts(sql);

    await sql.begin(async (tx) => {
      await tx.unsafe(`TRUNCATE TABLE ${TRUNCATE.map((t) => `"${t}"`).join(", ")} CASCADE`);

      // Aprendizado sai; constituição fica. As revisões acompanham por
      // `ON DELETE CASCADE` — são histórico DO conceito, e órfãs não
      // significam nada.
      await tx`DELETE FROM concepts WHERE bundle = 'learnings'`;
    });

    const after = await counts(sql);

    console.log("\nRazão zerado.\n");
    for (const [table, value] of Object.entries(before)) {
      console.log(`  ${table.padEnd(30)} ${String(value).padStart(5)} → ${after[table]}`);
    }
  } finally {
    await sql.end();
  }

  // Os PDFs: sem a linha em `documents` eles são inalcançáveis, e o hash de
  // conteúdo foi embora junto — então reenviar a mesma fatura volta a
  // funcionar em vez de esbarrar na deduplicação.
  await rm(BLOB_DIR, { recursive: true, force: true });
  console.log("\n  PDFs em .data/documents apagados.");
  console.log("\nPróximo passo: abra /conversa e envie uma fatura.\n");
}

async function counts(sql: postgres.Sql): Promise<Record<string, number>> {
  const tables = [...TRUNCATE, "concepts", "concept_revisions", "tenants", "user"];
  const result: Record<string, number> = {};

  for (const table of tables) {
    const [row] = await sql.unsafe(`SELECT count(*)::int AS value FROM "${table}"`);
    result[table] = (row as { value: number }).value;
  }

  return result;
}

/** Nunca imprima a senha do banco num log de terminal. */
function redact(url: string): string {
  return url.replace(/\/\/[^@]*@/, "//***@");
}

await main();
