import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import commitBatch from "../../agent/tools/commit_batch";
import listDocuments from "../../agent/tools/list_documents";
import proposeBatch from "../../agent/tools/propose_batch";
import readBatch from "../../agent/tools/read_batch";
import readConceptHistory from "../../agent/tools/read_concept_history";
import readReclassifications from "../../agent/tools/read_reclassifications";
import rejectBatch from "../../agent/tools/reject_batch";
import saveConcept from "../../agent/tools/save_concept";
import setCategory from "../../agent/tools/set_transaction_category";
import { closeConnections, ctxFor, dropTenant, freshTenant, seedDocument } from "../helpers/harness";

/**
 * As trilhas ganham leitor.
 *
 * Três tabelas eram escritas e nunca lidas — e cada uma sustentava uma
 * promessa quebrada: documento órfão inalcançável (`list_invoices` só via quem
 * tinha lote), "o que você mudou?" sem resposta (`transaction_reclassifications`
 * sem leitor), e o revert de `save_concept` apontando para revisões que
 * ninguém conseguia abrir.
 */

let tenantId: string;
let ctx: never;

describe("leitores das trilhas", () => {
  before(async () => {
    tenantId = await freshTenant();
    ctx = ctxFor(tenantId);
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  it("list_documents mostra o órfão e o rejeitado, com o próximo passo", async () => {
    const orphan = await seedDocument(tenantId, { filename: "sem-lote.pdf", issuer: null });

    const rejectedDoc = await seedDocument(tenantId, { filename: "descartada.pdf" });
    const draft = (await proposeBatch.execute(
      {
        documentId: rejectedDoc,
        declaredTotal: 1_000,
        transactions: [
          {
            date: "2026-06-01",
            originalDescription: "COMPRA DESCARTADA",
            amount: 1_000,
            extractionConfidence: "alta",
          },
        ],
      },
      ctx,
    )) as { batchId: string };
    await rejectBatch.execute({ batchId: draft.batchId, reason: "Enviada por engano." }, ctx);

    const listed = (await listDocuments.execute({}, ctx)) as {
      documents: Array<{
        documentId: string;
        batch: { status: string } | null;
        next: string | null;
      }>;
    };

    const orphanRow = listed.documents.find((row) => row.documentId === orphan);
    assert.ok(orphanRow, "o documento sem lote tem de aparecer");
    assert.equal(orphanRow.batch, null);
    assert.match(orphanRow.next ?? "", /extrator/);

    const rejectedRow = listed.documents.find((row) => row.documentId === rejectedDoc);
    assert.equal(rejectedRow?.batch?.status, "rejected");
    assert.match(rejectedRow?.next ?? "", /descartado/);

    // E o filtro de órfãos recorta.
    const orphansOnly = (await listDocuments.execute({ withoutBatch: true }, ctx)) as {
      documents: Array<{ documentId: string }>;
    };
    assert.ok(orphansOnly.documents.some((row) => row.documentId === orphan));
    assert.ok(!orphansOnly.documents.some((row) => row.documentId === rejectedDoc));
  });

  it("read_reclassifications conta o que mudou, e ensina a desfazer", async () => {
    const documentId = await seedDocument(tenantId, { filename: "registrada.pdf" });
    const proposed = (await proposeBatch.execute(
      {
        documentId,
        declaredTotal: 2_000,
        transactions: [
          {
            date: "2026-06-10",
            originalDescription: "PADARIA DO BAIRRO",
            merchant: "Padaria do Bairro",
            amount: 2_000,
            extractionConfidence: "alta",
          },
        ],
      },
      ctx,
    )) as { batchId: string };
    await commitBatch.execute({ batchId: proposed.batchId }, ctx);

    const opened = (await readBatch.execute({ batchId: proposed.batchId }, ctx)) as {
      transactions: Array<{ id: string }>;
    };
    const transactionId = opened.transactions[0]!.id;

    await setCategory.execute({ transactionId, category: "groceries" }, ctx);

    const trail = (await readReclassifications.execute({ transactionId }, ctx)) as {
      count: number;
      changes: Array<{ field: string; previousValue: string | null; newValue: string | null; author: string }>;
      undo: string;
    };

    assert.equal(trail.count, 1);
    assert.equal(trail.changes[0]?.field, "category");
    assert.equal(trail.changes[0]?.previousValue, null);
    assert.equal(trail.changes[0]?.newValue, "groceries");
    assert.match(trail.changes[0]?.author ?? "", /^human:/);
    assert.match(trail.undo, /previousValue/);
  });

  it("read_concept_history devolve as revisões — o corpo antigo do revert", async () => {
    await saveConcept.execute(
      {
        conceptId: "rules/padaria-do-bairro",
        type: "CategorizationRule",
        title: "Padaria do Bairro é Mercado",
        merchant: "padaria do bairro",
        body: "Aplica-se a [Mercado](/categories/groceries.md).",
        reason: "primeira versão",
      },
      ctx,
    );
    await saveConcept.execute(
      {
        conceptId: "rules/padaria-do-bairro",
        type: "CategorizationRule",
        title: "Padaria do Bairro é Restaurantes",
        merchant: "padaria do bairro",
        body: "Aplica-se a [Restaurantes](/categories/dining.md).",
        reason: "a pessoa mudou de ideia",
      },
      ctx,
    );

    const history = (await readConceptHistory.execute(
      { conceptId: "rules/padaria-do-bairro" },
      ctx,
    )) as {
      count: number;
      revisions: Array<{ current?: true; reason: string | null; body: string }>;
      revert: string;
    };

    assert.equal(history.count, 2);
    // A mais recente é o estado atual; a antiga carrega o corpo do revert.
    assert.equal(history.revisions[0]?.current, true);
    assert.match(history.revisions[0]?.body ?? "", /Restaurantes/);
    assert.match(history.revisions[1]?.body ?? "", /Mercado/);
    assert.match(history.revert, /save_concept/);
  });

  it("conceito inexistente recusa com o código próprio", async () => {
    const missing = (await readConceptHistory.execute(
      { conceptId: "rules/nao-existe" },
      ctx,
    )) as { error?: { code: string } };
    assert.equal(missing.error?.code, "conceito_nao_encontrado");
  });
});
