import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import aggregateByCategory from "../../agent/subagents/analyst/tools/aggregate_by_category";
import comparePeriods from "../../agent/subagents/analyst/tools/compare_periods";
import detectRecurrences from "../../agent/subagents/analyst/tools/detect_recurrences";
import queryLedger from "../../agent/subagents/analyst/tools/query_ledger";
import { saveAnalysis } from "../../agent/subagents/analyst/lib/save-analysis";
import commitBatch from "../../agent/tools/commit_batch";
import proposeBatch from "../../agent/tools/propose_batch";
import {
  closeConnections,
  ctxFor,
  dropTenant,
  freshTenant,
  seedDocument,
  viewFromReceipt,
} from "../helpers/harness";

/**
 * A invariante que faltava: todo número exibido reconstrói pelos próprios
 * lançamentos, e as partes somam o todo.
 *
 * O kernel já tinha testes de reconstrução (`analysis.test.ts`), mas a camada
 * de tools — a única que a pessoa VÊ — não tinha nenhum. A prova de que isso
 * importava veio de um experimento: invertendo um sinal em `totalSpend`, a
 * suíte do agente continuou verde. `ledger` e `web` acusaram; o agente, que
 * monta os painéis, não.
 *
 * Este arquivo é uma tabela de propósito. Uma tool nova que publique painel
 * sem passar por aqui fica visivelmente de fora.
 */

let tenantId: string;
let ctx: never;
let anteriorId: string;
let atualId: string;

type Linha = {
  description: string;
  amount: number;
  category: string;
  kind?: "purchase" | "refund" | "payment";
};

async function fatura(date: string, linhas: Linha[]) {
  const documentId = await seedDocument(tenantId, { filename: `${date}.pdf`, issuer: "Nubank" });
  const proposta = (await proposeBatch.execute(
    {
      documentId,
      issuer: "Nubank",
      declaredTotal: linhas.reduce((total, linha) => total + linha.amount, 0),
      transactions: linhas.map((linha) => ({
        date,
        originalDescription: linha.description,
        merchant: linha.description,
        amount: linha.amount,
        kind: linha.kind ?? "purchase",
        category: linha.category,
        extractionConfidence: "alta" as const,
      })),
    },
    ctx,
  )) as { batchId: string };
  await commitBatch.execute({ batchId: proposta.batchId }, ctx);
  return proposta.batchId;
}

type Painel = {
  metric?: { label: string; amount?: number; transactionIds: string[] };
  rows: Array<{ label: string; amount?: number; transactionIds: string[] }>;
};

/** A checagem que a pessoa faz de cabeça: somar a coluna e comparar com o topo. */
function linhasSomamODestaque(view: Painel) {
  if (view.metric?.amount === undefined) return;
  if (view.rows.length === 0) return;
  if (view.rows.some((row) => row.amount === undefined)) return;
  const soma = view.rows.reduce((total, row) => total + (row.amount ?? 0), 0);
  assert.equal(soma, view.metric.amount, "as linhas precisam somar o número em destaque");
}

describe("os painéis fecham com o razão", () => {
  before(async () => {
    tenantId = await freshTenant();
    ctx = ctxFor(tenantId);
    anteriorId = await fatura("2026-05-10", [
      { description: "Mercado", amount: 8_000, category: "groceries" },
      { description: "Restaurante", amount: 4_000, category: "dining" },
    ]);
    atualId = await fatura("2026-06-10", [
      { description: "Mercado", amount: 10_000, category: "groceries" },
      { description: "Estorno Mercado", amount: -2_000, category: "groceries", kind: "refund" },
      { description: "Restaurante", amount: 5_000, category: "dining" },
      // Categoria que existe SÓ por um crédito: ela sumia do painel como uma
      // linha de R$ 0,00 invisível, e o crédito abatia o topo sem aparecer.
      { description: "Estorno assinatura", amount: -1_500, category: "subscriptions", kind: "refund" },
      // Pagamento de fatura não é gasto e não pode entrar na composição.
      { description: "Pagamento recebido", amount: -20_000, category: "transfers", kind: "payment" },
    ]);
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  it("aggregate_by_category: as linhas somam o destaque, com estorno no recorte", async () => {
    const recibo = await aggregateByCategory.execute(
      { scope: { kind: "invoice", batchId: atualId } },
      ctx,
    );
    const view = (await viewFromReceipt(recibo, ctx)) as Painel;

    linhasSomamODestaque(view);
    // Compras brutas: 10.000 + 5.000. O pagamento não conta como gasto e os
    // estornos ficam fora das barras, nomeados no detalhe.
    assert.equal(view.metric?.amount, 15_000);
  });

  it("uma categoria só com crédito é nomeada, sem virar barra falsa", async () => {
    // Barra é compra. Dar barra de R$ 0,00 (o que acontecia antes) é
    // informativamente nada; dar-lhe o valor do crédito quebraria a soma das
    // linhas. Ela sai da composição e entra no resumo, com o valor.
    const recibo = await aggregateByCategory.execute(
      { scope: { kind: "invoice", batchId: atualId } },
      ctx,
    );
    const view = (await viewFromReceipt(recibo, ctx)) as Painel & { summary: string };

    assert.ok(
      !view.rows.some((row) => row.amount === 0),
      "nenhuma barra de R$ 0,00 fingindo ser composição",
    );
    assert.match(view.summary, /apenas créditos/i);
    assert.match(view.summary, /15,00/);
  });

  it("compare_periods: as variações por categoria somam a variação total", async () => {
    const recibo = await comparePeriods.execute(
      {
        current: { kind: "invoice", batchId: atualId },
        previous: { kind: "invoice", batchId: anteriorId },
      },
      ctx,
    );
    const view = (await viewFromReceipt(recibo, ctx)) as Painel;

    linhasSomamODestaque(view);
  });

  it("query_ledger: cada linha reconstrói pelo próprio lançamento", async () => {
    const recibo = await queryLedger.execute({ scope: { kind: "invoice", batchId: atualId } }, ctx);
    const view = (await viewFromReceipt(recibo, ctx)) as Painel;

    assert.ok(view.rows.length > 0);
    for (const row of view.rows) {
      assert.equal(row.transactionIds.length, 1, `a linha "${row.label}" cita um lançamento`);
    }
  });

  it("detect_recurrences: recorte sem padrão é resposta completa, não erro", async () => {
    const recibo = await detectRecurrences.execute(
      { scope: { kind: "invoice", batchId: atualId } },
      ctx,
    );

    assert.ok(!("error" in (recibo as object)), "não pode recusar por ausência de recorrência");
  });

  it("uma fatura em conferência responde igual nas duas tools", async () => {
    /*
     * A contradição que a pessoa via dentro do MESMO turno: "mostre os
     * lançamentos desta fatura" listava tudo, e "quanto gastei nesta fatura"
     * respondia que o recorte não possui lançamentos. Só `query_ledger` ligava
     * `includeProposed`; as tools de agregação não.
     *
     * A regra agora mora em `scopeFilter`, uma vez só: `invoice` é um recorte
     * sobre o DOCUMENTO, e a fatura em conferência é exatamente o documento
     * que está na mesa. Mês, intervalo e razão inteiro continuam sem rascunho.
     */
    const documentId = await seedDocument(tenantId, {
      filename: "rascunho.pdf",
      issuer: "Nubank",
    });
    const rascunho = (await proposeBatch.execute(
      {
        documentId,
        issuer: "Nubank",
        declaredTotal: 7_000,
        transactions: [
          {
            date: "2026-07-10",
            originalDescription: "Farmácia",
            merchant: "Farmácia",
            amount: 7_000,
            kind: "purchase" as const,
            category: "health",
            extractionConfidence: "alta" as const,
          },
        ],
      },
      ctx,
    )) as { batchId: string };

    const lista = (await viewFromReceipt(
      await queryLedger.execute({ scope: { kind: "invoice", batchId: rascunho.batchId } }, ctx),
      ctx,
    )) as Painel;
    const composicao = (await viewFromReceipt(
      await aggregateByCategory.execute(
        { scope: { kind: "invoice", batchId: rascunho.batchId } },
        ctx,
      ),
      ctx,
    )) as Painel & { summary: string };

    assert.equal(lista.rows.length, 1, "a lista enxerga a fatura em conferência");
    assert.equal(composicao.metric?.amount, 7_000, "e a composição enxerga a mesma fatura");
    // Enxergar não é apresentar como fato: o painel precisa DIZER.
    assert.match(composicao.summary, /confer[êe]ncia/i);
  });

  it("rascunho não contamina o recorte do MÊS", async () => {
    // O cuidado que justificava excluir rascunho continua de pé, e é outro:
    // num total de mês ele viraria fato. Só o recorte por documento o inclui.
    const view = (await viewFromReceipt(
      await aggregateByCategory.execute(
        { scope: { kind: "calendar_month", month: "2026-07" } },
        ctx,
      ),
      ctx,
    )) as Painel & { summary: string };

    assert.doesNotMatch(view.summary ?? "", /confer[êe]ncia/i);
  });

  it("recorte vazio publica painel válido", async () => {
    const recibo = await aggregateByCategory.execute(
      { scope: { kind: "calendar_month", month: "2026-01" } },
      ctx,
    );

    assert.ok(!("error" in (recibo as object)));
  });
});

/**
 * O guard precisa RECUSAR, não avisar.
 *
 * Sem estes casos, tudo acima provaria apenas que as tools estão certas hoje —
 * não que a próxima que errar será barrada. É a diferença entre um teste de
 * comportamento e uma invariante.
 */
describe("o guard recusa painel que não fecha", () => {
  let guardTenant: string;
  let guardCtx: never;

  before(async () => {
    guardTenant = await freshTenant();
    guardCtx = ctxFor(guardTenant);
  });

  after(async () => {
    await dropTenant(guardTenant);
    await closeConnections();
  });

  const testemunha = [
    { id: "t1", amount: 10_000 },
    { id: "t2", amount: 5_000 },
  ];

  it("recusa quando as linhas não somam o destaque", async () => {
    // Exatamente o defeito que estava coberto por teste: topo líquido, linhas
    // brutas. Cada número certo isoladamente, o painel mentindo mesmo assim.
    const resultado = (await saveAnalysis(
      {
        kind: "breakdown",
        title: "Composição",
        metric: { label: "Total", amount: 13_000, transactionIds: ["t1", "t2"] },
        rows: [
          { label: "Mercado", amount: 10_000, transactionIds: ["t1"] },
          { label: "Restaurante", amount: 5_000, transactionIds: ["t2"] },
        ],
      },
      { kind: "all" },
      guardCtx,
      testemunha,
    )) as { error?: { code: string; message: string } };

    assert.equal(resultado.error?.code, "painel_nao_reconcilia");
    assert.match(resultado.error?.message ?? "", /mesma escala/);
  });

  it("recusa quando um valor não corresponde aos próprios lançamentos", async () => {
    const resultado = (await saveAnalysis(
      {
        kind: "breakdown",
        title: "Composição",
        metric: { label: "Total", amount: 15_000, transactionIds: ["t1", "t2"] },
        rows: [{ label: "Mercado", amount: 99_999, transactionIds: ["t1"] }],
      },
      { kind: "all" },
      guardCtx,
      testemunha,
    )) as { error?: { code: string; message: string } };

    assert.equal(resultado.error?.code, "painel_nao_reconcilia");
    assert.match(resultado.error?.message ?? "", /Mercado/);
  });

  it("recusa proveniência de fora do recorte lido", async () => {
    // O painel montado com um recorte e os ids de outro: acontece quando o
    // valor é recalculado por fora depois de a consulta ter mudado.
    const resultado = (await saveAnalysis(
      {
        kind: "breakdown",
        title: "Composição",
        metric: { label: "Total", amount: 10_000, transactionIds: ["t1"] },
        rows: [{ label: "Fantasma", amount: 10_000, transactionIds: ["t404"] }],
      },
      { kind: "all" },
      guardCtx,
      testemunha,
    )) as { error?: { code: string } };

    assert.equal(resultado.error?.code, "painel_nao_reconcilia");
  });

  it("aceita o painel que fecha", async () => {
    const resultado = (await saveAnalysis(
      {
        kind: "breakdown",
        title: "Composição",
        metric: { label: "Total", amount: 15_000, transactionIds: ["t1", "t2"] },
        rows: [
          { label: "Mercado", amount: 10_000, transactionIds: ["t1"] },
          { label: "Restaurante", amount: 5_000, transactionIds: ["t2"] },
        ],
      },
      { kind: "all" },
      guardCtx,
      testemunha,
    )) as { error?: unknown; artifactId?: string };

    assert.equal(resultado.error, undefined);
    assert.ok(resultado.artifactId);
  });
});
