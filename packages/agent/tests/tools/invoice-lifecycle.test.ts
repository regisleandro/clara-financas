import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { getDb } from "@clara-financas/db";
import { batches, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq } from "drizzle-orm";

import commitBatch from "../../agent/tools/commit_batch";
import createAdjustment from "../../agent/tools/create_adjustment";
import editProposedBatch from "../../agent/tools/edit_proposed_batch";
import markReviewed from "../../agent/tools/mark_reviewed";
import nameIssuer from "../../agent/tools/name_issuer";
import proposeBatch from "../../agent/tools/propose_batch";
import readBatch from "../../agent/tools/read_batch";
import recategorize from "../../agent/tools/recategorize_transactions";
import rejectBatch from "../../agent/tools/reject_batch";
import queryLedger from "../../agent/subagents/analyst/tools/query_ledger";
import {
  closeConnections,
  ctxFor,
  dropTenant,
  freshTenant,
  seedDocument,
  viewFromReceipt,
} from "../helpers/harness";

/**
 * O ciclo de vida de uma fatura, ponta a ponta, contra o banco real.
 *
 * O roteiro é o caso que falhou em produção: uma fatura cuja soma não fecha
 * porque o PAGAMENTO da fatura anterior foi lido como compra. A diferença é
 * exatamente o valor do pagamento, e consertar exige corrigir a NATUREZA da
 * linha — que era o campo que `edit_proposed_batch` não aceitava.
 *
 * Nenhum modelo participa. Cada passo chama o `execute` da tool e confere o
 * BANCO depois.
 */

const PAYMENT_CENTS = -35_000;
const DECLARED_TOTAL = 12_500 + 4_200 + 317;

let tenantId: string;
let documentId: string;
let ctx: never;

/** As linhas do lote, direto do banco — a fonte de verdade das asserções. */
async function rowsOf(batchId: string) {
  return forTenant(
    tenantId,
    async (tx) =>
      tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.tenantId, tenantId), eq(transactions.batchId, batchId))),
    getDb(),
  );
}

async function batchOf(batchId: string) {
  const [row] = await forTenant(
    tenantId,
    async (tx) => tx.select().from(batches).where(eq(batches.id, batchId)).limit(1),
    getDb(),
  );
  return row;
}

describe("ciclo de vida de uma fatura", () => {
  before(async () => {
    tenantId = await freshTenant();
    documentId = await seedDocument(tenantId, { issuer: null });
    ctx = ctxFor(tenantId);
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  let batchId: string;
  let paymentId: string;

  it("propõe o lote e a conferência acusa a diferença do pagamento", async () => {
    const result = (await proposeBatch.execute(
      {
        documentId,
        issuer: null,
        periodStart: "2026-05-31",
        periodEnd: "2026-06-30",
        dueDate: "2026-07-07",
        declaredTotal: DECLARED_TOTAL,
        declaredSubtotals: { fees: 317, purchases: 12_500 + 4_200 },
        transactions: [
          {
            date: "2026-06-02",
            originalDescription: "PAGAMENTO EFETUADO EM 02/06",
            merchant: null,
            amount: PAYMENT_CENTS,
            // Lido como compra: é o erro que a fatura real trouxe.
            kind: "purchase",
            category: null,
            extractionConfidence: "baixa",
            page: 1,
          },
          {
            date: "2026-06-05",
            originalDescription: "MERCADO SAO JOSE 05/06",
            merchant: "Mercado São José",
            amount: 12_500,
            kind: "purchase",
            category: "groceries",
            extractionConfidence: "alta",
            page: 1,
          },
          {
            date: "2026-06-11",
            originalDescription: "ANTHROPIC* CLAUDE USD 8.00",
            merchant: "Anthropic",
            amount: 4_200,
            kind: "purchase",
            category: null,
            extractionConfidence: "media",
            page: 2,
          },
          {
            date: "2026-06-11",
            originalDescription: 'IOF de "ANTHROPIC* CLAUDE"',
            merchant: null,
            amount: 317,
            kind: "fee",
            category: "fees",
            extractionConfidence: "alta",
            page: 2,
          },
        ],
      },
      ctx,
    )) as { batchId: string; checksum: { result: string; difference: number } };

    batchId = result.batchId;
    assert.equal(result.checksum.result, "mismatch");
    // O pagamento entrou na soma porque foi lido como compra.
    assert.equal(result.checksum.difference, PAYMENT_CENTS);

    const rows = await rowsOf(batchId);
    assert.equal(rows.length, 4);
    assert.ok(rows.every((row) => row.status === "proposed"));
  });

  it("read_batch devolve os itens e o relatório persistido", async () => {
    const opened = (await readBatch.execute({ batchId }, ctx)) as {
      status: string;
      editable: boolean;
      checksum: { result: string; differenceCents: number; likelyCause?: string };
      transactions: Array<{ id: string; description: string; kind: string; suspect: boolean }>;
    };

    assert.equal(opened.status, "proposed");
    assert.equal(opened.editable, true);
    assert.equal(opened.checksum.result, "mismatch");
    assert.equal(opened.checksum.differenceCents, PAYMENT_CENTS);
    assert.equal(opened.transactions.length, 4);

    const payment = opened.transactions.find((row) => row.description.startsWith("PAGAMENTO"));
    assert.ok(payment, "o pagamento tem de vir na leitura do lote");
    paymentId = payment.id;
    // É o caminho que faltava: sem esta leitura, a Clara não tinha o id para
    // corrigir nada depois que o turno da proposta saiu do contexto.
    assert.equal(payment.kind, "purchase");
  });

  it("corrigir a natureza da linha fecha a conferência", async () => {
    const fixed = (await editProposedBatch.execute(
      { batchId, edits: [{ transactionId: paymentId, kind: "payment" }] },
      ctx,
    )) as { checksum: { result: string; difference: number }; applied: { edited: number } };

    assert.equal(fixed.checksum.result, "match");
    assert.equal(fixed.checksum.difference, 0);
    assert.equal(fixed.applied.edited, 1);

    const batch = await batchOf(batchId);
    assert.equal(batch?.checksumResult, "match");
  });

  it("remover uma linha duplicada não exige inventar uma edição", async () => {
    // O `edits.min(1)` antigo tornava esta operação — a mais comum quando a
    // causa provável é "item" — impossível sem um edit no-op.
    const added = (await editProposedBatch.execute(
      {
        batchId,
        add: [
          {
            date: "2026-06-12",
            originalDescription: "LINHA DUPLICADA",
            amount: 1_000,
            merchant: null,
          },
        ],
      },
      ctx,
    )) as { checksum: { result: string }; transactionCount: number };
    assert.equal(added.transactionCount, 5);
    assert.equal(added.checksum.result, "mismatch");

    const duplicated = (await rowsOf(batchId)).find(
      (row) => row.originalDescription === "LINHA DUPLICADA",
    );
    assert.ok(duplicated);

    const removed = (await editProposedBatch.execute(
      { batchId, removeTransactionIds: [duplicated.id] },
      ctx,
    )) as { checksum: { result: string }; transactionCount: number; applied: { removed: number } };

    assert.equal(removed.transactionCount, 4);
    assert.equal(removed.applied.removed, 1);
    assert.equal(removed.checksum.result, "match");
  });

  it("o analista enxerga a fatura em rascunho quando a pergunta é sobre ela", async () => {
    // A causa raiz do sintoma de produção: `loadLedger` excluía `proposed`,
    // então perguntar sobre a fatura em conferência devolvia vazio.
    const scoped = (await viewFromReceipt(
      await queryLedger.execute({ scope: { kind: "invoice", batchId } }, ctx),
      ctx,
    )) as { summary: string; rows: Array<{ detail: string }> };

    assert.equal(scoped.rows.length, 4);
    assert.match(scoped.summary, /4 ainda em conferência/);
    assert.ok(scoped.rows.every((row) => row.detail.includes("em conferência")));
    // Campos que antes eram amputados na fronteira e nunca chegavam ao modelo.
    assert.ok(scoped.rows.some((row) => row.detail.includes("payment")));
    assert.ok(scoped.rows.some((row) => row.detail.includes("confiança baixa")));

    // Fora do recorte de uma fatura, rascunho continua fora do razão.
    const global = (await viewFromReceipt(await queryLedger.execute({}, ctx), ctx)) as {
      metric: { text?: string };
    };
    assert.equal(global.metric.text, "Sem lançamentos");
  });

  it("busca por texto encontra o pagamento sem acerto exato de caixa", async () => {
    const found = (await viewFromReceipt(
      await queryLedger.execute(
        { scope: { kind: "invoice", batchId }, search: "pagamento" },
        ctx,
      ),
      ctx,
    )) as { rows: Array<{ transactionIds: string[] }> };
    assert.equal(found.rows.length, 1);
    assert.equal(found.rows[0]?.transactionIds[0], paymentId);

    // E o filtro por natureza responde "o que é pagamento nesta fatura".
    const payments = (await viewFromReceipt(
      await queryLedger.execute(
        { scope: { kind: "invoice", batchId }, kinds: ["payment"] },
        ctx,
      ),
      ctx,
    )) as { rows: unknown[] };
    assert.equal(payments.rows.length, 1);
  });

  it("commit_batch registra o razão", async () => {
    const committed = (await commitBatch.execute({ batchId }, ctx)) as {
      status: string;
      confirmedTransactions: number;
    };

    assert.equal(committed.status, "confirmed");
    assert.equal(committed.confirmedTransactions, 4);

    const rows = await rowsOf(batchId);
    assert.ok(rows.every((row) => row.status === "confirmed"));
  });

  it("depois de registrado, a correção é uma linha de ajuste", async () => {
    const refusedEdit = (await editProposedBatch.execute(
      { batchId, edits: [{ transactionId: paymentId, amount: 1 }] },
      ctx,
    )) as { error?: { code: string; hint?: string } };

    // A recusa agora ENSINA o caminho, em vez de mandar fazer algo inexistente.
    assert.equal(refusedEdit.error?.code, "lote_ja_decidido");
    assert.match(refusedEdit.error?.hint ?? "", /create_adjustment/);

    const groceries = (await rowsOf(batchId)).find((row) => row.category === "groceries");
    assert.ok(groceries);

    const adjustment = (await createAdjustment.execute(
      {
        transactionId: groceries.id,
        amountCents: -500,
        reason: "O cupom de R$ 5,00 não foi descontado na leitura.",
      },
      ctx,
    )) as {
      adjustmentId: string;
      resultingAmountCents: number;
      checksum: { result: string; difference: number | null };
    };

    assert.equal(adjustment.resultingAmountCents, 12_000);
    // O ajuste reconfere o LOTE, e o relatório conta a história verdadeira:
    // este razão agora soma R$ 5,00 a menos do que o documento declarou. Antes
    // o lote nem era tocado — nem para fechar uma divergência, nem para
    // registrar que uma decisão humana o afastou do documento.
    assert.equal(adjustment.checksum.result, "mismatch");
    assert.equal(adjustment.checksum.difference, -500);
    assert.equal((await batchOf(batchId))?.checksumResult, "mismatch");

    const rows = await rowsOf(batchId);
    const created = rows.find((row) => row.id === adjustment.adjustmentId);
    assert.equal(created?.status, "adjustment");
    assert.equal(created?.adjustsTransactionId, groceries.id);
    assert.equal(created?.amount, -500);
    // A linha original continua intacta: o ajuste soma por cima, não substitui.
    assert.equal(rows.find((row) => row.id === groceries.id)?.amount, 12_500);
  });

  it("categoriza um lançamento pelo mesmo gate usado em lote", async () => {
    const target = (await rowsOf(batchId)).find((row) => row.merchant === "Anthropic");
    assert.ok(target);

    const applied = (await recategorize.execute(
      {
        changes: [
          {
            transactionId: target.id,
            category: "subscriptions",
            categoryLabel: "Assinaturas",
          },
        ],
      },
      ctx,
    )) as { changed: number };

    assert.equal(applied.changed, 1);

    const after = (await rowsOf(batchId)).find((row) => row.id === target.id);
    assert.equal(after?.category, "subscriptions");
  });

  it("recusa categoria inexistente ensinando a criá-la", async () => {
    const target = (await rowsOf(batchId)).find((row) => row.merchant === "Anthropic");
    assert.ok(target);

    const rejected = (await recategorize.execute(
      {
        changes: [
          {
            transactionId: target.id,
            category: "pagamento-de-fatura",
            categoryLabel: "Pagamento de fatura",
          },
        ],
      },
      ctx,
    )) as { error?: { code: string; hint?: string }; validCategories?: string[] };

    assert.equal(rejected.error?.code, "categoria_desconhecida");
    assert.match(rejected.error?.hint ?? "", /save_concept/);
    assert.ok((rejected.validCategories ?? []).includes("groceries"));
  });

  it("marca como revisado e devolve para a fila", async () => {
    const rows = await rowsOf(batchId);
    const ids = rows.filter((row) => row.status === "confirmed").map((row) => row.id);

    const reviewed = (await markReviewed.execute({ transactionIds: ids }, ctx)) as {
      reviewed: number;
    };
    assert.equal(reviewed.reviewed, ids.length);

    const pending = (await viewFromReceipt(
      await queryLedger.execute(
        { scope: { kind: "invoice", batchId }, reviewed: false },
        ctx,
      ),
      ctx,
    )) as { metric: { text?: string } };
    // Só o ajuste (já nasce revisado) e nada mais: a fila esvaziou.
    assert.equal(pending.metric.text, "Sem lançamentos");

    const reopened = (await markReviewed.execute(
      { transactionIds: [ids[0]!], reopen: true },
      ctx,
    )) as { reopened: number };
    assert.equal(reopened.reopened, 1);
  });

  it("nomeia a operadora do documento", async () => {
    const named = (await nameIssuer.execute({ documentId, issuer: "Nubank" }, ctx)) as {
      issuer: string;
      previousIssuer: string | null;
    };
    assert.equal(named.issuer, "Nubank");
    assert.equal(named.previousIssuer, null);
  });

  it("rejeitar um lote registrado é recusado; um rascunho é descartado", async () => {
    const refusedReject = (await rejectBatch.execute(
      { batchId, reason: "teste" },
      ctx,
    )) as { error?: { code: string } };
    assert.equal(refusedReject.error?.code, "lote_ja_registrado");

    const otherDocument = await seedDocument(tenantId, { filename: "outra.pdf" });
    const draft = (await proposeBatch.execute(
      {
        documentId: otherDocument,
        declaredTotal: 1_000,
        transactions: [
          {
            date: "2026-06-20",
            originalDescription: "COMPRA QUALQUER",
            amount: 1_000,
            extractionConfidence: "alta",
          },
        ],
      },
      ctx,
    )) as { batchId: string };

    const discarded = (await rejectBatch.execute(
      { batchId: draft.batchId, reason: "Fatura enviada por engano." },
      ctx,
    )) as { status: string; discardedTransactions: number };

    assert.equal(discarded.status, "rejected");
    assert.equal(discarded.discardedTransactions, 1);

    const batch = await batchOf(draft.batchId);
    assert.equal(batch?.status, "rejected");
    assert.equal((await rowsOf(draft.batchId)).length, 0);
  });
});
