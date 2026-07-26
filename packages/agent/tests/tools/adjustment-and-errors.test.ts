import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import commitBatch from "../../agent/tools/commit_batch";
import createAdjustment from "../../agent/tools/create_adjustment";
import proposeBatch from "../../agent/tools/propose_batch";
import readBatch from "../../agent/tools/read_batch";
import recategorize from "../../agent/tools/recategorize_transactions";
import rejectBatch from "../../agent/tools/reject_batch";
import { closeConnections, ctxFor, dropTenant, freshTenant, seedDocument } from "../helpers/harness";

/**
 * Os dois defeitos que faziam uma aprovação parecer o que ela não é.
 *
 * 1. `create_adjustment` corrigia a linha e não tocava no lote: a fatura já
 *    ajustada continuava com `checksumResult: mismatch` para sempre — listada
 *    como divergente na tela de revisão, escolhida pelos starters e descrita
 *    ao modelo como problema aberto. A pessoa resolvia; o sistema reafirmava.
 *
 * 2. Erros na forma antiga (`{ error: "frase solta" }`) e sucessos vazios
 *    (`{ changed: 0 }`) chegavam à interface como quebra vermelha ou como
 *    check verde — nunca como o que de fato eram.
 */

let tenantId: string;
let ctx: never;

describe("ajuste fecha a conferência e erros têm forma", () => {
  before(async () => {
    tenantId = await freshTenant();
    ctx = ctxFor(tenantId);
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  it("um ajuste do tamanho exato da diferença fecha a divergência do lote", async () => {
    const documentId = await seedDocument(tenantId, { filename: "divergente.pdf" });

    // A extração leu R$ 25,00 onde o documento diz R$ 20,00: mismatch de +500.
    const proposed = (await proposeBatch.execute(
      {
        documentId,
        declaredTotal: 2_000,
        transactions: [
          {
            date: "2026-06-10",
            originalDescription: "PADARIA CENTRAL 10/06",
            merchant: "Padaria Central",
            amount: 2_500,
            extractionConfidence: "baixa",
          },
        ],
      },
      ctx,
    )) as { batchId: string; checksum: { result: string; difference: number } };

    assert.equal(proposed.checksum.result, "mismatch");
    assert.equal(proposed.checksum.difference, 500);

    // Registrada mesmo divergente — o caminho que o produto permite, com a
    // divergência visível. A correção pós-registro é a linha de ajuste.
    const committed = (await commitBatch.execute({ batchId: proposed.batchId }, ctx)) as {
      status: string;
      confirmedTransactions: number;
    };
    assert.equal(committed.status, "confirmed");

    const opened = (await readBatch.execute({ batchId: proposed.batchId }, ctx)) as {
      transactions: Array<{ id: string }>;
    };
    const targetId = opened.transactions[0]!.id;

    const adjusted = (await createAdjustment.execute(
      {
        transactionId: targetId,
        amountCents: -500,
        reason: "A extração leu R$ 25,00; o documento diz R$ 20,00.",
      },
      ctx,
    )) as { checksum: { result: string; difference: number | null } };

    // O ponto da correção: a conferência FECHA, e fecha NO LOTE — é o que tira
    // a fatura da lista de divergentes e do snapshot como problema aberto.
    assert.equal(adjusted.checksum.result, "match");
    assert.equal(adjusted.checksum.difference, 0);
  });

  it("commit_batch de lote inexistente devolve erro estruturado com hint", async () => {
    const missing = (await commitBatch.execute({ batchId: "bat_inexistente" }, ctx)) as {
      error?: { code: string; hint?: string; retryable: boolean };
    };

    // Era `{ error: "lote não encontrado" }` — sem código, sem hint, e a
    // interface pintava de vermelho o passo mais visível do produto.
    assert.equal(missing.error?.code, "lote_nao_encontrado");
    assert.equal(missing.error?.retryable, true);
    assert.match(missing.error?.hint ?? "", /list_invoices/);
  });

  it("commit_batch de lote rejeitado é recusa, não quebra", async () => {
    const documentId = await seedDocument(tenantId, { filename: "descartada.pdf" });
    const draft = (await proposeBatch.execute(
      {
        documentId,
        declaredTotal: 1_000,
        transactions: [
          {
            date: "2026-06-15",
            originalDescription: "COMPRA ENGANO",
            amount: 1_000,
            extractionConfidence: "alta",
          },
        ],
      },
      ctx,
    )) as { batchId: string };

    await rejectBatch.execute({ batchId: draft.batchId, reason: "Enviada por engano." }, ctx);

    const refusedCommit = (await commitBatch.execute({ batchId: draft.batchId }, ctx)) as {
      error?: { code: string; retryable: boolean };
    };

    assert.equal(refusedCommit.error?.code, "lote_ja_decidido");
    // Recusa por estado: repetir a mesma chamada nunca resolve.
    assert.equal(refusedCommit.error?.retryable, false);
  });

  it("recategorizar só ids de rascunho é erro visível, não sucesso vazio", async () => {
    const documentId = await seedDocument(tenantId, { filename: "rascunho.pdf" });
    const draft = (await proposeBatch.execute(
      {
        documentId,
        declaredTotal: 3_000,
        transactions: [
          {
            date: "2026-06-18",
            originalDescription: "MERCADO EM RASCUNHO",
            merchant: "Mercado",
            amount: 3_000,
            extractionConfidence: "alta",
          },
        ],
      },
      ctx,
    )) as { batchId: string };

    const opened = (await readBatch.execute({ batchId: draft.batchId }, ctx)) as {
      transactions: Array<{ id: string }>;
    };
    const draftId = opened.transactions[0]!.id;

    const noop = (await recategorize.execute(
      {
        changes: [{ transactionId: draftId, category: "groceries", categoryLabel: "Mercado" }],
      },
      ctx,
    )) as {
      error?: { code: string; hint?: string; retryable: boolean };
      changed?: number;
      notFound?: string[];
    };

    // Antes: `{ changed: 0 }` sem erro — a pessoa aprovava no cartão, nada
    // mudava, e o trace mostrava check verde. Indistinguível de ter funcionado.
    assert.equal(noop.error?.code, "nenhuma_alteracao");
    assert.equal(noop.changed, 0);
    assert.deepEqual(noop.notFound, [draftId]);
    assert.match(noop.error?.hint ?? "", /edit_proposed_batch/);
  });
});
