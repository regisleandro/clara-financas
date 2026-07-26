import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { getDb } from "@clara-financas/db";
import { user } from "@clara-financas/db/schema/auth";
import { notifications } from "@clara-financas/db/schema/notification";
import { tenants } from "@clara-financas/db/schema/tenant";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { eq } from "drizzle-orm";

import { sweepDueDates } from "../../agent/lib/reminders";
import deactivateCommitment from "../../agent/tools/deactivate_commitment";
import listNotifications from "../../agent/tools/list_notifications";
import markReviewed from "../../agent/tools/mark_reviewed";
import nameIssuer from "../../agent/tools/name_issuer";
import proposeBatch from "../../agent/tools/propose_batch";
import commitBatch from "../../agent/tools/commit_batch";
import saveCommitment from "../../agent/tools/save_commitment";
import setProactivity from "../../agent/tools/set_proactivity";
import { closeConnections, ctxFor, dropTenant, freshTenant, seedDocument } from "../helpers/harness";

/**
 * As guardas da rodada P2, contra o banco real.
 *
 * Quatro promessas: o consentimento de proatividade desliga a varredura
 * inteira; a dupla contagem (fatura parcial + fechada) é acusada na proposta;
 * a operadora converge para a grafia já registrada; e o atestado em massa
 * passa a pedir cartão enquanto o pequeno continua sem cerimônia.
 */

let tenantId: string;
let ctx: never;

describe("guardas da rodada P2", () => {
  before(async () => {
    tenantId = await freshTenant();
    ctx = ctxFor(tenantId);

    // A varredura parte do REGISTRY de tenants (control plane), que o harness
    // não semeia — sem esta linha, o sweep simplesmente não visita o tenant de
    // teste e o teste de consentimento passaria vazio.
    const db = getDb();
    await db.insert(user).values({
      id: `usr_${tenantId}`,
      name: "Pessoa de Teste",
      email: `${tenantId}@teste.local`,
    });
    await db.insert(tenants).values({
      id: tenantId,
      ownerUserId: `usr_${tenantId}`,
      slug: tenantId,
      status: "ready",
    });
  });

  after(async () => {
    const db = getDb();
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(user).where(eq(user.id, `usr_${tenantId}`));
    await dropTenant(tenantId);
    await closeConnections();
  });

  it("set_proactivity desligado cala a varredura; religado, ela volta", async () => {
    await saveCommitment.execute(
      { kind: "custom", title: "Aluguel", dueDate: "2026-07-28", remindDaysBefore: 5 },
      ctx,
    );

    const off = (await setProactivity.execute({ enabled: false }, ctx)) as {
      proactivity: string;
    };
    assert.equal(off.proactivity, "off");

    // Dentro da janela de aviso (28/07 está a 2 dias de 26/07), mas o
    // interruptor está desligado: nada sai para ESTE tenant.
    const silent = await sweepDueDates(new Date("2026-07-26T15:00:00Z"));
    assert.equal(silent.created.filter((row) => row.tenantId === tenantId).length, 0);

    const on = (await setProactivity.execute({ enabled: true }, ctx)) as { proactivity: string };
    assert.equal(on.proactivity, "on");

    const speaking = await sweepDueDates(new Date("2026-07-26T15:00:00Z"));
    assert.equal(speaking.created.filter((row) => row.tenantId === tenantId).length, 1);

    // E o aviso criado aparece no leitor, ainda não visto.
    const listed = (await listNotifications.execute({ unreadOnly: true }, ctx)) as {
      count: number;
      notifications: Array<{ title: string; seenAt: string | null }>;
    };
    assert.equal(listed.count, 1);
    assert.match(listed.notifications[0]?.title ?? "", /Aluguel/);
    assert.equal(listed.notifications[0]?.seenAt, null);

    // E no banco: exatamente um aviso, do processo de vencimentos.
    const stored = await forTenant(
      tenantId,
      async (tx) => tx.select().from(notifications).where(eq(notifications.tenantId, tenantId)),
      getDb(),
    );
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.createdBy, "process:due_dates");
  });

  it("a proposta acusa possível dupla contagem contra outro documento", async () => {
    const closedInvoice = await seedDocument(tenantId, { filename: "fechada.pdf" });
    const partialInvoice = await seedDocument(tenantId, { filename: "parcial.pdf" });

    const line = {
      date: "2026-06-15",
      originalDescription: "SUPERMERCADO GRANDE 15/06",
      merchant: "Supermercado Grande",
      amount: 25_000,
      extractionConfidence: "alta" as const,
    };

    // A "parcial" entra primeiro e é registrada.
    const partial = (await proposeBatch.execute(
      { documentId: partialInvoice, declaredTotal: 25_000, transactions: [line] },
      ctx,
    )) as { batchId: string; duplicateSuspects?: unknown };
    assert.equal(partial.duplicateSuspects, undefined);
    await commitBatch.execute({ batchId: partial.batchId }, ctx);

    // A "fechada" do mesmo ciclo traz a mesma compra: as duas conferências
    // passariam, e o gasto entraria em dobro. Agora a proposta acusa.
    const closed = (await proposeBatch.execute(
      {
        documentId: closedInvoice,
        declaredTotal: 26_000,
        transactions: [
          line,
          {
            date: "2026-06-20",
            originalDescription: "PADARIA NOVA",
            merchant: "Padaria Nova",
            amount: 1_000,
            extractionConfidence: "alta" as const,
          },
        ],
      },
      ctx,
    )) as {
      checksum: { result: string };
      duplicateSuspects?: { count: number; sample: Array<{ existingTransactionId: string }> };
    };

    assert.equal(closed.checksum.result, "match");
    assert.equal(closed.duplicateSuspects?.count, 1);
    assert.ok(closed.duplicateSuspects?.sample[0]?.existingTransactionId);
  });

  it("a operadora converge para a grafia já registrada", async () => {
    const named = await seedDocument(tenantId, { filename: "com-nome.pdf", issuer: "Nubank" });
    void named;
    const unnamed = await seedDocument(tenantId, { filename: "sem-nome.pdf", issuer: null });

    const result = (await nameIssuer.execute(
      { documentId: unnamed, issuer: "NUBANK" },
      ctx,
    )) as { issuer: string; note?: string };

    // "NUBANK" dito agora vira a grafia que já existia — uma linha só na
    // matriz por operadora.
    assert.equal(result.issuer, "Nubank");
    assert.match(result.note ?? "", /unificada/);
  });

  it("mark_reviewed: poucos sem cartão, muitos com cartão, reabrir nunca", () => {
    const approvalOf = (transactionIds: string[], reopen?: boolean) =>
      (markReviewed as unknown as { approval: (ctx: unknown) => unknown }).approval({
        ...(ctxFor(tenantId) as object),
        toolInput: { transactionIds, ...(reopen === undefined ? {} : { reopen }) },
      });

    const few = Array.from({ length: 5 }, (_, index) => `txn_${index}`);
    const many = Array.from({ length: 21 }, (_, index) => `txn_${index}`);

    assert.equal(approvalOf(few), "not-applicable");
    assert.equal(approvalOf(many), "user-approval");
    // Reabrir devolve itens à fila — a direção segura não pede cartão.
    assert.equal(approvalOf(many, true), "not-applicable");
  });

  it("deactivate_commitment continua funcionando com o interruptor geral ligado", async () => {
    // Guarda de regressão: o interruptor geral não substitui a porta
    // individual — os dois convivem.
    const saved = (await saveCommitment.execute(
      { kind: "custom", title: "Academia", dueDate: "2026-08-15" },
      ctx,
    )) as { commitmentId: string };

    const off = (await deactivateCommitment.execute(
      { commitmentId: saved.commitmentId, title: "Academia" },
      ctx,
    )) as { active: string };
    assert.equal(off.active, "no");
  });
});
