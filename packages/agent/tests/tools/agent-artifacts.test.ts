import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { getDb } from "@clara-financas/db";
import { agentArtifacts } from "@clara-financas/db/schema/agent-artifact";
import { transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq } from "drizzle-orm";

import aggregateByCategory from "../../agent/subagents/analyst/tools/aggregate_by_category";
import comparePeriods from "../../agent/subagents/analyst/tools/compare_periods";
import saveCategorization from "../../agent/subagents/categorizer/tools/save_categorization";
import commitBatch from "../../agent/tools/commit_batch";
import presentAnalysis from "../../agent/tools/present_analysis";
import presentCategorization from "../../agent/tools/present_categorization";
import proposeBatch from "../../agent/tools/propose_batch";
import recategorize from "../../agent/tools/recategorize_transactions";
import {
  closeConnections,
  ctxFor,
  dropTenant,
  freshTenant,
  seedDocument,
  viewFromReceipt,
} from "../helpers/harness";

let tenantId: string;
let ctx: never;
let previousBatchId: string;
let currentBatchId: string;

async function invoice(
  date: string,
  rows: Array<{ description: string; amount: number; category: string; kind?: "purchase" | "refund" }>,
) {
  const documentId = await seedDocument(tenantId, { filename: `${date}.pdf`, issuer: "Nubank" });
  const proposed = (await proposeBatch.execute(
    {
      documentId,
      issuer: "Nubank",
      declaredTotal: rows.reduce((sum, row) => sum + row.amount, 0),
      transactions: rows.map((row) => ({
        date,
        originalDescription: row.description,
        merchant: row.description,
        amount: row.amount,
        kind: row.kind ?? "purchase",
        category: row.category,
        extractionConfidence: "alta" as const,
      })),
    },
    ctx,
  )) as { batchId: string };
  await commitBatch.execute({ batchId: proposed.batchId }, ctx);
  return proposed.batchId;
}

describe("artefatos opacos entre subagentes e coordenadora", () => {
  before(async () => {
    tenantId = await freshTenant();
    ctx = ctxFor(tenantId);
    previousBatchId = await invoice("2026-05-10", [
      { description: "Mercado", amount: 8_000, category: "groceries" },
      { description: "Restaurante", amount: 4_000, category: "dining" },
    ]);
    currentBatchId = await invoice("2026-06-10", [
      { description: "Mercado", amount: 10_000, category: "groceries" },
      { description: "Estorno Mercado", amount: -2_000, category: "groceries", kind: "refund" },
      { description: "Restaurante", amount: 5_000, category: "dining" },
    ]);
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  it("o analista devolve recibo sem números e o painel mantém estornos válidos", async () => {
    const receipt = (await aggregateByCategory.execute(
      { scope: { kind: "calendar_month", month: "2026-06", issuer: "Nubank" } },
      ctx,
    )) as Record<string, unknown>;
    assert.deepEqual(Object.keys(receipt).sort(), [
      "artifactId",
      "artifactKind",
      "nextAction",
      "viewKind",
      "warnings",
    ]);
    assert.equal(receipt.nextAction, "present_analysis");

    const view = (await viewFromReceipt(receipt, ctx)) as {
      metric: { label: string; amount: number; detail: string; transactionIds: string[] };
      rows: Array<{ label: string; amount: number; share?: number; detail: string }>;
    };

    /*
     * Este teste FIXAVA o defeito como contrato.
     *
     * Ele exigia `metric.amount === 13_000` (líquido) enquanto as linhas
     * somavam 15_000 (bruto) — as duas asserções conviviam no mesmo bloco e
     * ninguém notou, porque nenhum CI jamais rodou esta suíte. Somar a coluna
     * na tela dava 20 reais a mais que o número em destaque logo acima dela.
     *
     * A invariante correta é a que a pessoa verifica de cabeça: as linhas
     * fecham com o destaque.
     */
    const somaDasLinhas = view.rows.reduce((total, row) => total + row.amount, 0);
    assert.equal(somaDasLinhas, view.metric.amount, "as linhas precisam somar o destaque");

    // Bruto em tudo: compras no topo (10.000 + 5.000), com o crédito de 2.000
    // nomeado no detalhe em vez de embutido numa escala diferente.
    assert.equal(view.metric.label, "Compras no período");
    assert.equal(view.metric.amount, 15_000);
    assert.match(view.metric.detail, /créditos.+líquido/i);

    const market = view.rows.find((row) => row.label === "Mercado");
    assert.equal(market?.amount, 10_000);
    assert.equal(market?.share, 2 / 3);
    // A proveniência da linha acompanha o valor da linha: só as compras. Antes
    // ela trazia junto o estorno, então abrir a origem de R$ 100,00 listava
    // lançamentos que somavam R$ 80,00.
    assert.match(market?.detail ?? "", /créditos/i);
    assert.ok(view.rows.every((row) => row.share === undefined || (row.share >= 0 && row.share <= 1)));
  });

  it("mês vazio preserva agosto e não substitui pela última fatura", async () => {
    const receipt = await aggregateByCategory.execute(
      { scope: { kind: "calendar_month", month: "2026-08" } },
      ctx,
    );
    const view = (await viewFromReceipt(receipt, ctx)) as {
      metric: { text: string };
      summary: string;
    };
    assert.equal(view.metric.text, "Sem lançamentos");
    assert.match(view.summary, /2026-08/);

    const [stored] = await forTenant(
      tenantId,
      async (tx) =>
        tx
          .select({ payload: agentArtifacts.payload })
          .from(agentArtifacts)
          .where(eq(agentArtifacts.id, (receipt as { artifactId: string }).artifactId))
          .limit(1),
      getDb(),
    );
    const payload = stored?.payload as { requestedScope: unknown; actualScope: unknown };
    assert.deepEqual(payload.actualScope, payload.requestedScope);
    assert.deepEqual(payload.requestedScope, { kind: "calendar_month", month: "2026-08" });
  });

  it("comparação agrega a proveniência do delta sem cálculo pelo modelo", async () => {
    const receipt = await comparePeriods.execute(
      {
        current: { kind: "invoice", batchId: currentBatchId },
        previous: { kind: "invoice", batchId: previousBatchId },
      },
      ctx,
    );
    const view = (await viewFromReceipt(receipt, ctx)) as {
      kind: string;
      metric: { amount: number; transactionIds: string[] };
      rows: Array<{ share: number; transactionIds: string[] }>;
    };
    assert.equal(view.kind, "comparison");
    assert.equal(view.metric.amount, 1_000);
    assert.equal(view.metric.transactionIds.length, 5);
    assert.ok(view.rows.every((row) => row.transactionIds.length > 0));
    assert.ok(view.rows.every((row) => row.share >= 0 && row.share <= 1));
  });

  it("um recibo não atravessa sessões e expiração falha de forma recuperável", async () => {
    const receipt = (await aggregateByCategory.execute(
      { scope: { kind: "invoice", batchId: currentBatchId } },
      ctx,
    )) as { artifactId: string };
    const otherSession = ctxFor(tenantId, "usr_test", `ses_other_${tenantId}`);
    const refused = (await presentAnalysis.execute(
      { artifactId: receipt.artifactId },
      otherSession,
    )) as { error: { code: string } };
    assert.equal(refused.error.code, "artefato_nao_encontrado");

    const expiredArtifactId = `art_expired${tenantId.replace(/[^a-z0-9]/g, "").slice(-8)}`;
    await forTenant(
      tenantId,
      async (tx) =>
        tx.insert(agentArtifacts).values({
          id: expiredArtifactId,
          tenantId,
          parentSessionId: `ses_${tenantId}`,
          kind: "analysis",
          payload: {},
          expiresAt: new Date(0),
        }),
      getDb(),
    );
    const expired = (await presentAnalysis.execute(
      { artifactId: expiredArtifactId },
      ctx,
    )) as { error: { code: string; retryable: boolean } };
    assert.equal(expired.error.code, "artefato_expirado");
    assert.equal(expired.error.retryable, true);
  });

  it("categorizador apresenta e aplica por proposalId, sempre atrás do gate", async () => {
    const [target] = await forTenant(
      tenantId,
      async (tx) =>
        tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(
            and(
              eq(transactions.batchId, currentBatchId),
              eq(transactions.tenantId, tenantId),
              eq(transactions.category, "dining"),
            ),
          )
          .limit(1),
      getDb(),
    );
    assert.ok(target);

    const receipt = (await saveCategorization.execute(
      {
        matchedRules: [],
        proposals: [
          {
            merchant: "Mercado",
            categoryId: "groceries",
            categoryLabel: "Mercado",
            reason: "Compra de alimentação.",
            transactionIds: [target.id],
          },
        ],
        merchantAliases: [],
        warnings: [],
      },
      ctx,
    )) as { artifactId: string };
    const presented = (await presentCategorization.execute(
      { artifactId: receipt.artifactId },
      ctx,
    )) as { actionableCategoryProposalIds: string[]; view: { kind: string } };
    assert.equal(presented.view.kind, "proposal");
    assert.equal(presented.actionableCategoryProposalIds.length, 1);
    assert.equal(recategorize.approval?.(ctx), "user-approval");

    const applied = (await recategorize.execute(
      {
        artifactId: receipt.artifactId,
        proposalIds: presented.actionableCategoryProposalIds,
      },
      ctx,
    )) as { changed: number; unchanged: number };
    assert.equal(applied.changed, 1);
  });
});
