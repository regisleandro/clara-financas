import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * Migração que MEXE EM DADOS precisa lidar com a RLS forçada.
 *
 * Este teste existe porque o defeito foi cometido: a migração 0024 nasceu com
 * três `UPDATE` sobre tabelas com `FORCE ROW LEVEL SECURITY` e sem nada que
 * suspendesse a política. Ela passou verde no desenvolvimento local — onde o
 * `DATABASE_ADMIN_URL` costuma ser superuser, que ignora RLS — e teria passado
 * verde em produção também, alterando ZERO linhas.
 *
 * É o pior desfecho possível para uma migração: não falha e não corrige. O
 * `db-migrate` reportaria sucesso, o PR seria fechado, e o dado continuaria
 * errado sem nenhum sinal.
 *
 * A causa é que o papel de produção é o DONO do schema sem BYPASSRLS
 * (`clara_owner`, criado NOSUPERUSER NOBYPASSRLS de propósito, para que o
 * `isolation.test.ts` signifique alguma coisa). Com `FORCE ROW LEVEL SECURITY`
 * a política vale também para o dono, e ela exige `app.tenant_id` — que
 * migração nenhuma define, porque migração não roda dentro de `forTenant`.
 *
 * A migração 0014 já tinha encontrado isso e resolvido com `NO FORCE`
 * temporário. O conhecimento estava no repositório e não impediu a repetição,
 * que é exatamente quando a regra precisa virar teste.
 *
 * O teste é de TEXTO, deliberadamente: ele lê os arquivos e não o banco, então
 * roda sem Postgres e falha no PR que introduzir a próxima migração de dados
 * desprotegida — antes de ela chegar a produção e não fazer nada.
 */

const DIRETORIO = new URL("./migrations/", import.meta.url);

/** DML no início de uma instrução, ignorando comentários e indentação. */
const DML = /^\s*(update|insert\s+into|delete\s+from)\s+"?([a-z_]+)"?/gim;

/**
 * As tabelas com `FORCE ROW LEVEL SECURITY` — lidas das próprias migrações,
 * e não escritas à mão aqui. Uma tabela nova que ganhe RLS forçada entra
 * nesta lista sozinha; uma lista manual seria a segunda cópia da verdade.
 */
async function tabelasComRlsForcada(arquivos: Map<string, string>): Promise<Set<string>> {
  const forcadas = new Set<string>();
  for (const [, sql] of [...arquivos].sort()) {
    for (const match of sql.matchAll(
      /alter\s+table\s+"?([a-z_]+)"?\s+(no\s+)?force\s+row\s+level\s+security/gi,
    )) {
      const [, tabela, negado] = match;
      if (negado === undefined) forcadas.add(tabela!);
      // `NO FORCE` no meio de uma migração é a suspensão temporária, não a
      // remoção definitiva — a lista final é o estado depois do último
      // arquivo, e toda suspensão daqui é seguida da reativação.
    }
  }
  return forcadas;
}

describe("migrações de dados sob RLS forçada", () => {
  it("todo UPDATE/DELETE/INSERT em tabela com RLS forçada suspende a política", async () => {
    const nomes = (await readdir(DIRETORIO)).filter((nome) => nome.endsWith(".sql")).sort();
    assert.ok(nomes.length > 0, "não achei migração nenhuma — o caminho está errado?");

    const arquivos = new Map<string, string>();
    for (const nome of nomes) {
      arquivos.set(nome, await readFile(new URL(nome, DIRETORIO), "utf8"));
    }
    const forcadas = await tabelasComRlsForcada(arquivos);
    assert.ok(
      forcadas.has("transactions"),
      "esperava encontrar `transactions` entre as tabelas com RLS forçada",
    );

    const problemas: string[] = [];
    for (const [nome, sql] of arquivos) {
      // Comentários fora: um `-- update transactions` explicando algo não é DML.
      const semComentarios = sql.replace(/^\s*--.*$/gm, "");
      const alvos = new Set(
        [...semComentarios.matchAll(DML)].map((match) => match[2]!).filter((t) => forcadas.has(t)),
      );
      if (alvos.size === 0) continue;

      for (const tabela of alvos) {
        const suspende = new RegExp(
          `alter\\s+table\\s+"?${tabela}"?\\s+no\\s+force\\s+row\\s+level\\s+security`,
          "i",
        ).test(semComentarios);
        const restaura = new RegExp(
          `alter\\s+table\\s+"?${tabela}"?\\s+force\\s+row\\s+level\\s+security`,
          "i",
        ).test(semComentarios);

        if (!suspende) {
          problemas.push(
            `${nome}: escreve em "${tabela}", que tem RLS forçada, sem ALTER TABLE ... NO FORCE ROW LEVEL SECURITY. ` +
              `Rodando como o dono sem BYPASSRLS a instrução não alcança linha nenhuma e a migração passa verde sem corrigir nada.`,
          );
        } else if (!restaura) {
          problemas.push(
            `${nome}: suspende a RLS de "${tabela}" e não a restaura. A proteção não pode terminar desligada.`,
          );
        }
      }
    }

    assert.deepEqual(problemas, [], `\n  ${problemas.join("\n  ")}\n`);
  });
});
