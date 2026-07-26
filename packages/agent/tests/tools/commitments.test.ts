import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { getDb } from "@clara-financas/db";
import { commitments } from "@clara-financas/db/schema/commitment";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { eq } from "drizzle-orm";

import deactivateCommitment from "../../agent/tools/deactivate_commitment";
import listCommitments from "../../agent/tools/list_commitments";
import saveCommitment from "../../agent/tools/save_commitment";
import { closeConnections, ctxFor, dropTenant, freshTenant } from "../helpers/harness";

/**
 * O ciclo de vida do lembrete — inclusive a porta de saída.
 *
 * `commitments.active` existia com os dois valores e só recebia "yes": criado
 * um compromisso, a varredura diária avisava para sempre. Estes testes fixam o
 * caminho completo: criar, desativar (o banco fica `active='no'`, a lista
 * some), a idempotência do já-inativo, e o comportamento documentado do upsert
 * de `save_commitment` — que REATIVA, e por isso passa pelo cartão.
 */

let tenantId: string;
let ctx: never;

async function rowOf(commitmentId: string) {
  const [row] = await forTenant(
    tenantId,
    async (tx) => tx.select().from(commitments).where(eq(commitments.id, commitmentId)).limit(1),
    getDb(),
  );
  return row;
}

describe("lembretes: criar, desativar, reativar", () => {
  before(async () => {
    tenantId = await freshTenant();
    ctx = ctxFor(tenantId);
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  let commitmentId: string;

  it("save_commitment cria e list_commitments lista", async () => {
    const saved = (await saveCommitment.execute(
      {
        kind: "invoice_due",
        title: "Fatura do Nubank",
        counterparty: "Nubank",
        dueDate: "2026-08-07",
        expectedAmount: 123_45,
      },
      ctx,
    )) as { commitmentId: string };
    commitmentId = saved.commitmentId;

    const listed = (await listCommitments.execute({}, ctx)) as {
      count: number;
      commitments: Array<{ id: string; title: string }>;
    };
    assert.equal(listed.count, 1);
    assert.equal(listed.commitments[0]?.id, commitmentId);
  });

  it("deactivate_commitment desliga no banco e a lista esvazia", async () => {
    const deactivated = (await deactivateCommitment.execute(
      { commitmentId, title: "Fatura do Nubank" },
      ctx,
    )) as { active: string; alreadyInactive?: boolean };

    assert.equal(deactivated.active, "no");
    assert.equal(deactivated.alreadyInactive, undefined);
    assert.equal((await rowOf(commitmentId))?.active, "no");

    const listed = (await listCommitments.execute({}, ctx)) as { count: number };
    assert.equal(listed.count, 0);
  });

  it("desativar de novo é idempotente — replay do gate não vira erro", async () => {
    const again = (await deactivateCommitment.execute(
      { commitmentId, title: "Fatura do Nubank" },
      ctx,
    )) as { active: string; alreadyInactive?: boolean };

    assert.equal(again.active, "no");
    assert.equal(again.alreadyInactive, true);
  });

  it("id inexistente recusa com código e hint", async () => {
    const missing = (await deactivateCommitment.execute(
      { commitmentId: "cmt_nao_existe", title: "qualquer" },
      ctx,
    )) as { error?: { code: string; hint?: string } };

    assert.equal(missing.error?.code, "compromisso_nao_encontrado");
    assert.match(missing.error?.hint ?? "", /list_commitments/);
  });

  it("o upsert de save_commitment REATIVA — comportamento documentado, atrás do cartão", async () => {
    const resaved = (await saveCommitment.execute(
      {
        kind: "invoice_due",
        title: "Fatura do Nubank",
        counterparty: "Nubank",
        dueDate: "2026-09-07",
      },
      ctx,
    )) as { commitmentId: string };

    // Mesmo (kind, counterparty) → mesma linha, reativada.
    assert.equal(resaved.commitmentId, commitmentId);
    assert.equal((await rowOf(commitmentId))?.active, "yes");
  });
});
