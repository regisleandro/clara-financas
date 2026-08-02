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

type ResolutionError = { error: { code: string; message: string } };

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

  it("a próxima divergente não anda enquanto a ativa continua divergente", async () => {
    await readBatch.execute({ batchId: newestId, onlySuspects: false }, ctx);

    const first = (await resolveInvoiceReference.execute(
      { reference: "next_with_divergence" },
      ctx,
    )) as Resolved;
    assert.equal(first.batchId, newestId);
    assert.equal(first.checksumResult, "mismatch");

    // A mesma pergunta, de novo: é o caso da pessoa que repete "faça isso".
    // Uma leitura que se movesse aqui apontaria para uma fatura que ela nunca
    // viu, e o alvo do turno anterior deixaria de pertencer ao lote.
    const again = (await resolveInvoiceReference.execute(
      { reference: "next_with_divergence" },
      ctx,
    )) as Resolved;
    assert.equal(again.batchId, newestId);

    const snapshot = await loadSnapshot(tenantId, `ses_${tenantId}`);
    assert.equal(snapshot.activeInvoiceAtTurnStart?.batchId, newestId);
  });

  it("skipActive é o único caminho que avança para outra fatura", async () => {
    await readBatch.execute({ batchId: newestId, onlySuspects: false }, ctx);

    const next = (await resolveInvoiceReference.execute(
      { reference: "next_with_divergence", skipActive: true },
      ctx,
    )) as Resolved;
    assert.equal(next.batchId, middleId);
    assert.equal(next.checksumResult, "mismatch");

    const active = (await resolveInvoiceReference.execute(
      { reference: "active" },
      ctx,
    )) as Resolved;
    assert.equal(active.batchId, middleId);

    // Depois da última divergente, avançar não inventa um lote por aproximação.
    const exhausted = (await resolveInvoiceReference.execute(
      { reference: "next_with_divergence", skipActive: true },
      ctx,
    )) as ResolutionError;
    assert.equal(exhausted.error.code, "referencia_de_fatura_nao_encontrada");
    assert.match(exhausted.error.message, /depois da atual/);
  });
});

describe("a última FATURA é uma fatura", () => {
  let tenantId: string;
  let ctx: never;
  let faturaId: string;

  before(async () => {
    tenantId = await freshTenant();
    ctx = ctxFor(tenantId);

    const criar = async (
      kind: "credit_card_invoice" | "bank_statement",
      periodEnd: string,
    ): Promise<string> => {
      const documentId = await seedDocument(tenantId, {
        filename: `${kind}-${periodEnd}.pdf`,
        issuer: "Nubank",
        kind,
      });
      const result = (await proposeBatch.execute(
        {
          documentId,
          issuer: "Nubank",
          periodStart: `${periodEnd.slice(0, 8)}01`,
          periodEnd,
          dueDate: null,
          declaredTotal: 100,
          transactions: [
            {
              date: periodEnd,
              originalDescription: "Lançamento",
              merchant: "Teste",
              amount: 100,
              kind: "purchase" as const,
              category: null,
              extractionConfidence: "alta" as const,
              page: 1,
            },
          ],
        },
        ctx,
      )) as { batchId: string };
      return result.batchId;
    };

    faturaId = await criar("credit_card_invoice", "2026-03-31");
    // Extrato enviado DEPOIS: é o documento mais recente do razão, e não é
    // uma fatura.
    await criar("bank_statement", "2026-04-30");
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  it("um extrato mais recente não responde por 'a última fatura'", async () => {
    // O tipo já viajava no resultado (`documentKind`) e simplesmente não era
    // consultado: `latest` pegava o primeiro da lista, qualquer que fosse.
    const resolvido = (await resolveInvoiceReference.execute({ reference: "latest" }, ctx)) as {
      batchId: string;
      documentKind: string;
    };

    assert.equal(resolvido.documentKind, "credit_card_invoice");
    assert.equal(resolvido.batchId, faturaId);
  });
});
