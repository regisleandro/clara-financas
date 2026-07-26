import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import proposeBatch from "../../agent/tools/propose_batch";
import readBatch from "../../agent/tools/read_batch";
import resolveInvoiceReference from "../../agent/tools/resolve_invoice_reference";
import { loadSnapshot } from "../../agent/lib/snapshot";
import {
  closeConnections,
  ctxFor,
  dropTenant,
  freshTenant,
  seedDocument,
} from "../helpers/harness";

type Resolved = {
  resolvedFrom: "active" | "latest" | "next_with_divergence";
  batchId: string;
  checksumResult: string | null;
};

describe("foco determinístico de fatura por sessão", () => {
  let tenantId: string;
  let ctx: never;
  let newestId: string;
  let middleId: string;

  before(async () => {
    tenantId = await freshTenant();
    ctx = ctxFor(tenantId);

    const create = async (
      issuer: string,
      periodEnd: string,
      declaredTotal: number,
    ): Promise<string> => {
      const documentId = await seedDocument(tenantId, {
        filename: `${issuer}-${periodEnd}.pdf`,
        issuer,
      });
      const result = (await proposeBatch.execute(
        {
          documentId,
          issuer,
          periodStart: `${periodEnd.slice(0, 8)}01`,
          periodEnd,
          dueDate: null,
          declaredTotal,
          transactions: [
            {
              date: periodEnd,
              originalDescription: "Compra de teste",
              merchant: "Teste",
              amount: 100,
              kind: "purchase",
              category: null,
              extractionConfidence: "alta",
              page: 1,
            },
          ],
        },
        ctx,
      )) as { batchId: string };
      return result.batchId;
    };

    await create("Antiga", "2026-01-31", 100);
    middleId = await create("Intermediária", "2026-02-28", 101);
    newestId = await create("Mais recente", "2026-03-31", 102);
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  it("essa fatura usa o foco persistido, não a posição no histórico", async () => {
    const result = (await resolveInvoiceReference.execute(
      { reference: "active" },
      ctx,
    )) as Resolved;
    assert.equal(result.batchId, newestId);
  });

  it("a última usa uma ordenação estável pelo ciclo", async () => {
    await readBatch.execute({ batchId: middleId, onlySuspects: false }, ctx);

    const result = (await resolveInvoiceReference.execute(
      { reference: "latest" },
      ctx,
    )) as Resolved;
    assert.equal(result.batchId, newestId);
  });

  it("a próxima divergente avança depois da fatura ativa", async () => {
    await readBatch.execute({ batchId: newestId, onlySuspects: false }, ctx);

    const result = (await resolveInvoiceReference.execute(
      { reference: "next_with_divergence" },
      ctx,
    )) as Resolved;
    assert.equal(result.batchId, middleId);
    assert.equal(result.checksumResult, "mismatch");

    const active = (await resolveInvoiceReference.execute(
      { reference: "active" },
      ctx,
    )) as Resolved;
    assert.equal(active.batchId, middleId);

    const snapshot = await loadSnapshot(tenantId, `ses_${tenantId}`);
    assert.equal(snapshot.activeInvoice?.batchId, middleId);
  });
});
