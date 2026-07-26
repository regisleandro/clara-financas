import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import applyInvoiceResolution from "../../agent/tools/apply_invoice_resolution";
import commitBatch from "../../agent/tools/commit_batch";
import prepareBatchRegistration from "../../agent/tools/prepare_batch_registration";
import prepareInvoiceResolution from "../../agent/tools/prepare_invoice_resolution";
import proposeBatch from "../../agent/tools/propose_batch";
import readBatch from "../../agent/tools/read_batch";
import {
  closeConnections,
  ctxFor,
  dropTenant,
  freshTenant,
  seedDocument,
} from "../helpers/harness";

describe("propostas financeiras persistidas", () => {
  let tenantId: string;
  let ctx: ReturnType<typeof ctxFor>;

  before(async () => {
    tenantId = await freshTenant();
    ctx = ctxFor(tenantId);
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  it("registra por proposta e fecha a divergência com ajuste calculado", async () => {
    const documentId = await seedDocument(tenantId, { filename: "fatura-workflow.pdf" });
    const draft = (await proposeBatch.execute(
      {
        documentId,
        declaredTotal: 2_000,
        transactions: [
          {
            date: "2026-07-10",
            originalDescription: "COMPRA",
            amount: 2_500,
            extractionConfidence: "alta",
          },
        ],
      },
      ctx,
    )) as { batchId: string };

    const registration = (await prepareBatchRegistration.execute(
      { batchId: draft.batchId },
      ctx,
    )) as { proposalId: string };
    const committed = (await commitBatch.execute(
      { proposalId: registration.proposalId },
      ctx,
    )) as { status: string; actionId: string };
    assert.equal(committed.status, "confirmed");
    assert.equal(committed.actionId, registration.proposalId);
    const registrationReplay = (await commitBatch.execute(
      { proposalId: registration.proposalId },
      ctx,
    )) as { actionId: string; alreadyConfirmed: boolean };
    assert.equal(registrationReplay.alreadyConfirmed, true);
    assert.equal(registrationReplay.actionId, registration.proposalId);

    const proposal = (await prepareInvoiceResolution.execute(
      {
        batchId: draft.batchId,
        reason: "Compensar a diferença atual da conferência.",
      },
      ctx,
    )) as {
      proposalId: string;
      differenceBeforeCents: number;
      adjustmentCents: number;
      targetTransactionId: null;
    };
    assert.equal(proposal.differenceBeforeCents, 500);
    assert.equal(proposal.adjustmentCents, -500);
    assert.equal(proposal.targetTransactionId, null);

    const receipt = (await applyInvoiceResolution.execute(
      { proposalId: proposal.proposalId },
      ctx,
    )) as {
      status: string;
      differenceAfterCents: number;
      mutationId: string;
    };
    assert.equal(receipt.status, "applied");
    assert.equal(receipt.differenceAfterCents, 0);

    const replay = (await applyInvoiceResolution.execute(
      { proposalId: proposal.proposalId },
      ctx,
    )) as { mutationId: string; alreadyApplied: boolean };
    assert.equal(replay.alreadyApplied, true);
    assert.equal(replay.mutationId, receipt.mutationId);

    const opened = (await readBatch.execute({ batchId: draft.batchId }, ctx)) as {
      checksum: { result: string; differenceCents: number };
    };
    assert.equal(opened.checksum.result, "match");
    assert.equal(opened.checksum.differenceCents, 0);
  });
});
