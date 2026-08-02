import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { getDb } from "@clara-financas/db";
import { agentToolEvents } from "@clara-financas/db/schema/agent-event";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { eq } from "drizzle-orm";

import telemetry from "../../agent/hooks/telemetry";
import { closeConnections, ctxFor, dropTenant, freshTenant } from "../helpers/harness";

/**
 * A pergunta que não tinha resposta em produção: qual ferramenta falhou, com
 * que argumento, e com que erro?
 */

let tenantId: string;
let ctx: never;

const events = () =>
  forTenant(
    tenantId,
    async (tx) => tx.select().from(agentToolEvents).where(eq(agentToolEvents.tenantId, tenantId)),
    getDb(),
  );

const requested = (callId: string, toolName: string, input: unknown) => ({
  type: "actions.requested" as const,
  data: { actions: [{ callId, toolName, input }] },
});

const resulted = (callId: string, output: unknown, status?: string) => ({
  type: "action.result" as const,
  data: { ...(status === undefined ? {} : { status }), result: { callId, output } },
});

describe("telemetria de execução", () => {
  before(async () => {
    tenantId = await freshTenant();
    ctx = ctxFor(tenantId);
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  it("grava a falha com código, causa e o identificador do alvo", async () => {
    const hooks = telemetry.events!;
    hooks["actions.requested"]!(
      requested("c1", "edit_proposed_batch", {
        batchId: "bat_123",
        edits: [{ transactionId: "txn_1", amount: 100 }],
      }) as never,
      ctx,
    );
    await hooks["action.result"]!(
      resulted("c1", {
        error: {
          code: "lote_ja_decidido",
          message: "Esta fatura já foi registrada no razão.",
          retryable: false,
        },
      }) as never,
      ctx,
    );

    const [row] = await events();
    assert.equal(row?.toolName, "edit_proposed_batch");
    assert.equal(row?.status, "falha");
    assert.equal(row?.errorCode, "lote_ja_decidido");
    assert.equal(row?.errorMessage, "Esta fatura já foi registrada no razão.");
    // O id do alvo é o que amarra o log ao dado — sem ele, "falhou ao editar
    // uma fatura" não diz qual.
    assert.equal((row?.inputSummary as Record<string, unknown>).batchId, "bat_123");
    assert.equal((row?.inputSummary as Record<string, unknown>).editsCount, 1);
  });

  it("o resumo do input não carrega dinheiro nem descrição", async () => {
    const hooks = telemetry.events!;
    hooks["actions.requested"]!(
      requested("c2", "propose_batch", {
        documentId: "doc_9",
        declaredTotal: 438_792,
        transactions: [{ originalDescription: "PADARIA CENTRAL", amount: 12_500 }],
      }) as never,
      ctx,
    );
    await hooks["action.result"]!(
      resulted("c2", { error: { code: "documento_ja_registrado", retryable: false } }) as never,
      ctx,
    );

    const row = (await events()).find((event) => event.toolName === "propose_batch");
    const summary = JSON.stringify(row?.inputSummary);
    assert.match(summary, /doc_9/);
    assert.match(summary, /transactionsCount/);
    // O log não pode virar uma segunda cópia do razão.
    assert.doesNotMatch(summary, /PADARIA/);
    assert.doesNotMatch(summary, /438792|12500/);
  });

  it("recusa que aponta a saída é recuperável, não falha", async () => {
    const hooks = telemetry.events!;
    hooks["actions.requested"]!(
      requested("c3", "recategorize_transactions", { changes: [] }) as never,
      ctx,
    );
    await hooks["action.result"]!(
      resulted("c3", {
        error: { code: "categoria_desconhecida", message: "Não existe.", retryable: true },
      }) as never,
      ctx,
    );

    const row = (await events()).find((event) => event.toolName === "recategorize_transactions");
    assert.equal(row?.status, "recuperavel");
  });

  it("um turno que morre sem tool nenhuma falhar também deixa rastro", async () => {
    await telemetry.events!["turn.failed"]!(
      { type: "turn.failed", data: { turnId: "t9", error: "Contexto excedido." } } as never,
      ctx,
    );

    const row = (await events()).find((event) => event.toolName === "turn");
    assert.equal(row?.status, "falha");
    assert.equal(row?.turnId, "t9");
    assert.equal(row?.errorMessage, "Contexto excedido.");
  });

  it("sucesso não polui a tabela por padrão", async () => {
    const before = (await events()).length;
    const hooks = telemetry.events!;
    hooks["actions.requested"]!(requested("c4", "read_batch", { batchId: "bat_1" }) as never, ctx);
    await hooks["action.result"]!(resulted("c4", { batchId: "bat_1" }) as never, ctx);

    assert.equal((await events()).length, before);
  });

  it("sucesso crítico de comportamento sempre fornece denominador", async () => {
    const hooks = telemetry.events!;
    hooks["actions.requested"]!(
      requested("c5", "present_analysis", { artifactId: "art_probe" }) as never,
      ctx,
    );
    await hooks["action.result"]!(
      resulted("c5", { artifactId: "art_probe", presented: "metric" }) as never,
      ctx,
    );

    const row = (await events()).find((event) => event.callId === "c5");
    assert.equal(row?.toolName, "present_analysis");
    assert.equal(row?.status, "ok");
    assert.equal((row?.inputSummary as Record<string, unknown>).artifactId, "art_probe");
  });
});
