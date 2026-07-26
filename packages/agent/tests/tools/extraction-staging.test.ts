import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { getDb } from "@clara-financas/db";
import { extractionStagings } from "@clara-financas/db/schema/extraction-staging";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { eq } from "drizzle-orm";

import saveExtraction from "../../agent/subagents/extractor/tools/save_extraction";
import editProposedBatch from "../../agent/tools/edit_proposed_batch";
import proposeFromExtraction from "../../agent/tools/propose_batch_from_extraction";
import readBatch from "../../agent/tools/read_batch";
import { closeConnections, ctxFor, dropTenant, freshTenant, seedDocument } from "../helpers/harness";

/**
 * A passagem por referência, ponta a ponta.
 *
 * O defeito que ela elimina: o extrator devolvia a fatura inteira pelo
 * contexto, e a coordenadora retranscrevia cada linha no input de
 * `propose_batch` — custo proporcional ao documento e risco de erro de cópia
 * no elo mais crítico. Aqui o extrator persiste (`save_extraction`), devolve
 * um recibo, e a proposta consome a staging pelo id, sem transcrição.
 *
 * E o segundo defeito, que a proposta por referência tornaria mais frequente:
 * repropor apagava em silêncio um rascunho que a pessoa já tinha corrigido.
 */

const EXTRACTION = (documentId: string) => ({
  documentId,
  issuer: "Nubank",
  periodStart: "2026-05-31",
  periodEnd: "2026-06-30",
  dueDate: "2026-07-07",
  declaredTotal: 10_000,
  declaredSubtotals: { fees: null, purchases: 10_000 },
  transactions: [
    {
      date: "2026-06-05",
      originalDescription: "MERCADO CENTRAL 05/06",
      merchant: "Mercado Central",
      amount: 6_000,
      kind: "purchase" as const,
      installment: null,
      category: "groceries",
      extractionConfidence: "alta" as const,
      page: 1,
    },
    {
      date: "2026-06-12",
      originalDescription: "FARMACIA BOA SAUDE",
      merchant: null,
      amount: 4_000,
      kind: "purchase" as const,
      installment: null,
      category: null,
      extractionConfidence: "media" as const,
      page: 1,
    },
  ],
  warnings: ["Página 2 sem camada de texto legível."],
});

let tenantId: string;
let documentId: string;
let ctx: never;

async function stagingsOf(document: string) {
  return forTenant(
    tenantId,
    async (tx) =>
      tx.select().from(extractionStagings).where(eq(extractionStagings.documentId, document)),
    getDb(),
  );
}

describe("extração por referência", () => {
  before(async () => {
    tenantId = await freshTenant();
    documentId = await seedDocument(tenantId, { issuer: null });
    ctx = ctxFor(tenantId);
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  let extractionId: string;
  let batchId: string;

  it("save_extraction persiste o payload e devolve o recibo", async () => {
    const saved = (await saveExtraction.execute(EXTRACTION(documentId), ctx)) as {
      extractionId: string;
      documentId: string;
      transactionCount: number;
    };

    extractionId = saved.extractionId;
    assert.equal(saved.documentId, documentId);
    assert.equal(saved.transactionCount, 2);

    const rows = await stagingsOf(documentId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.payload.transactions.length, 2);
  });

  it("uma leitura nova substitui a staging anterior", async () => {
    const again = (await saveExtraction.execute(EXTRACTION(documentId), ctx)) as {
      extractionId: string;
    };
    extractionId = again.extractionId;

    const rows = await stagingsOf(documentId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, extractionId);
  });

  it("propose_batch_from_extraction cria o rascunho sem transcrição e consome a staging", async () => {
    const proposed = (await proposeFromExtraction.execute({ extractionId }, ctx)) as {
      batchId: string;
      issuer: string | null;
      transactionCount: number;
      extractionWarnings?: string[];
      checksum: { result: string };
    };

    batchId = proposed.batchId;
    assert.equal(proposed.transactionCount, 2);
    assert.equal(proposed.checksum.result, "match");
    // O emissor da extração subiu ao documento e volta no retorno.
    assert.equal(proposed.issuer, "Nubank");
    // Os avisos do extrator não se perdem na referência.
    assert.deepEqual(proposed.extractionWarnings, ["Página 2 sem camada de texto legível."]);

    const opened = (await readBatch.execute({ batchId }, ctx)) as {
      transactions: Array<{ description: string }>;
    };
    assert.equal(opened.transactions.length, 2);

    // Consumida: o rascunho é a única fonte a partir daqui.
    assert.equal((await stagingsOf(documentId)).length, 0);
  });

  it("sem staging, o erro aponta de volta ao extrator", async () => {
    const missing = (await proposeFromExtraction.execute({ documentId }, ctx)) as {
      error?: { code: string; hint?: string };
    };
    assert.equal(missing.error?.code, "extracao_nao_encontrada");
    assert.match(missing.error?.hint ?? "", /extrator/);
  });

  it("repropor sobre rascunho editado recusa; com consentimento, substitui", async () => {
    // A pessoa corrige o rascunho — dez turnos de trabalho, no caso real.
    const opened = (await readBatch.execute({ batchId }, ctx)) as {
      transactions: Array<{ id: string; description: string }>;
    };
    const target = opened.transactions.find((row) => row.description.startsWith("FARMACIA"));
    assert.ok(target);
    await editProposedBatch.execute(
      { batchId, edits: [{ transactionId: target.id, amount: 4_100 }] },
      ctx,
    );

    // Uma extração nova do mesmo documento (a Clara entendeu "reenvie" como
    // "reproponha")…
    const saved = (await saveExtraction.execute(EXTRACTION(documentId), ctx)) as {
      extractionId: string;
    };

    // …não pode descartar as correções em silêncio.
    const refusedOverwrite = (await proposeFromExtraction.execute(
      { extractionId: saved.extractionId },
      ctx,
    )) as { error?: { code: string; hint?: string }; batchId?: string };

    assert.equal(refusedOverwrite.error?.code, "rascunho_editado");
    assert.equal(refusedOverwrite.batchId, batchId);
    assert.match(refusedOverwrite.error?.hint ?? "", /overwriteEditedDraft/);

    // Com o consentimento explícito, a substituição acontece.
    const overwritten = (await proposeFromExtraction.execute(
      { extractionId: saved.extractionId, overwriteEditedDraft: true },
      ctx,
    )) as { batchId: string; transactionCount: number };

    assert.notEqual(overwritten.batchId, batchId);
    assert.equal(overwritten.transactionCount, 2);
  });

  it("rascunho intocado é substituído sem cerimônia (idempotência original)", async () => {
    // O lote corrente veio direto da staging, sem nenhuma edição.
    const saved = (await saveExtraction.execute(EXTRACTION(documentId), ctx)) as {
      extractionId: string;
    };
    const replaced = (await proposeFromExtraction.execute(
      { extractionId: saved.extractionId },
      ctx,
    )) as { batchId: string; error?: unknown };

    assert.equal(replaced.error, undefined);
    assert.ok(replaced.batchId);
  });
});
