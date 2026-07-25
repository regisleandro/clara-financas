import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { sql } from "drizzle-orm";

import { createDbClient, type Database } from "./index";
import { concepts, conceptRevisions } from "./schema/knowledge";
import { forTenant } from "./tenant-scope";

/**
 * Teste de isolamento entre tenants na camada de dados.
 *
 * O plano é explícito: nenhuma etapa começa com este teste falhando. Ele cobre
 * a camada 5 (RLS) — a única que não depende de alguém lembrar de aplicar um
 * filtro. As camadas 1–3 (token, guard, approval) são exercitadas em outro
 * teste, contra o agente rodando.
 *
 * Exige DATABASE_URL apontando para o papel de aplicação (clara_app). Se
 * apontar para um superusuário, a RLS é ignorada e o teste avisa em vez de
 * passar em falso — um teste de isolamento que passa por engano é pior que
 * teste nenhum.
 */

const TENANT_A = `tnt_test_a_${randomUUID().slice(0, 8)}`;
const TENANT_B = `tnt_test_b_${randomUUID().slice(0, 8)}`;

let db: Database;
let closeConnection: () => Promise<void>;

async function seed(tenantId: string, conceptId: string) {
  const id = `cpt_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await forTenant(
    tenantId,
    async (tx) => {
      await tx.insert(concepts).values({
        id,
        tenantId,
        bundle: "learnings",
        conceptId,
        type: "CategorizationRule",
        frontmatter: { type: "CategorizationRule", title: conceptId },
        body: `Conceito de teste para ${tenantId}.`,
      });
    },
    db,
  );
  return id;
}

describe("isolamento entre tenants (RLS)", () => {
  before(async () => {
    const connection = createDbClient();
    db = connection.db;
    closeConnection = async () => {
      await connection.client.end({ timeout: 5 });
    };

    const [role] = await db.execute<{
      current_user: string;
      is_superuser: boolean;
      bypassrls: boolean;
    }>(sql`
      select current_user,
             usesuper as is_superuser,
             usebypassrls as bypassrls
        from pg_user
       where usename = current_user
    `);

    assert.ok(role, "não foi possível ler o papel corrente");
    assert.equal(
      role.is_superuser,
      false,
      `DATABASE_URL conecta como superusuário (${role.current_user}); a RLS seria ignorada e este teste passaria em falso. Use o papel clara_app.`,
    );
    assert.equal(
      role.bypassrls,
      false,
      `O papel ${role.current_user} tem BYPASSRLS; a RLS seria ignorada.`,
    );

    await seed(TENANT_A, "merchants/padaria-do-a");
    await seed(TENANT_B, "merchants/padaria-do-b");
  });

  after(async () => {
    // Limpeza roda dentro do escopo de cada tenant — a própria RLS impede
    // apagar o que é do outro, que é justamente o ponto do teste.
    // As revisões saem por CASCADE: a aplicação não tem DELETE nelas, de
    // propósito, e a integridade referencial roda como dona da tabela.
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await forTenant(
        tenantId,
        async (tx) => {
          await tx.execute(sql`delete from concepts where tenant_id = ${tenantId}`);
        },
        db,
      );
    }

    // Sem fechar a conexão o runner de testes nunca encerra.
    await closeConnection();
  });

  it("SELECT sem filtro de aplicação só enxerga o próprio tenant", async () => {
    const rows = await forTenant(TENANT_A, async (tx) => tx.select().from(concepts), db);

    assert.ok(rows.length > 0, "o tenant A deveria enxergar o próprio conceito");
    assert.ok(
      rows.every((row) => row.tenantId === TENANT_A),
      "vazou linha de outro tenant num select sem where",
    );
  });

  it("não é possível ler o conceito do outro tenant nem pedindo explicitamente", async () => {
    const rows = await forTenant(
      TENANT_A,
      async (tx) => tx.execute(sql`select id from concepts where tenant_id = ${TENANT_B}`),
      db,
    );

    assert.equal(rows.length, 0, "o tenant A leu dado do tenant B");
  });

  it("não é possível escrever linha carimbada com outro tenant", async () => {
    await assert.rejects(
      () =>
        forTenant(
          TENANT_A,
          async (tx) => {
            await tx.insert(concepts).values({
              id: `cpt_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
              // Carimbo forjado: é o que a política WITH CHECK precisa barrar.
              tenantId: TENANT_B,
              bundle: "learnings",
              conceptId: "merchants/forjado",
              type: "CategorizationRule",
              frontmatter: { type: "CategorizationRule" },
              body: "não deveria entrar",
            });
          },
          db,
        ),
      "a RLS deveria recusar a escrita cruzada",
    );
  });

  it("sem tenant no contexto, nada é visível (falha fechado)", async () => {
    const rows = await db.execute(sql`select id from concepts`);
    assert.equal(rows.length, 0, "sem app.tenant_id definido, o banco não deveria devolver nada");
  });

  it("a trilha de auditoria é append-only: UPDATE e DELETE são negados", async () => {
    const conceptRowId = await seed(TENANT_A, `merchants/auditoria-${randomUUID().slice(0, 6)}`);

    await forTenant(
      TENANT_A,
      async (tx) => {
        await tx.insert(conceptRevisions).values({
          id: `rev_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
          tenantId: TENANT_A,
          conceptRowId,
          author: "human:teste",
          reason: "revisão inicial",
          frontmatter: { type: "CategorizationRule" },
          body: "corpo original",
        });
      },
      db,
    );

    await assert.rejects(
      () =>
        forTenant(
          TENANT_A,
          async (tx) =>
            tx.execute(sql`update concept_revisions set body = 'reescrito' where tenant_id = ${TENANT_A}`),
          db,
        ),
      "UPDATE na trilha de auditoria deveria ser negado",
    );

    await assert.rejects(
      () =>
        forTenant(
          TENANT_A,
          async (tx) =>
            tx.execute(sql`delete from concept_revisions where tenant_id = ${TENANT_A}`),
          db,
        ),
      "DELETE na trilha de auditoria deveria ser negado",
    );
  });
});
