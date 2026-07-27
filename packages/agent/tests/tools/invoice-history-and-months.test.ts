import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { parseViewResult } from "@clara-financas/views";

import commitBatch from "../../agent/tools/commit_batch";
import listInvoices from "../../agent/tools/list_invoices";
import proposeBatch from "../../agent/tools/propose_batch";
import aggregateByMonth from "../../agent/subagents/analyst/tools/aggregate_by_month";
import { closeConnections, ctxFor, dropTenant, freshTenant, seedDocument } from "../helpers/harness";

/**
 * "Pedi pra listar as faturas mês a mês e não tive resposta."
 *
 * O mesmo defeito da triagem sem categoria, num lugar diferente: a pergunta
 * tinha dados e não tinha FORMA. Dois buracos, e cada teste abaixo é um deles.
 *
 *  1. `list_invoices` só devolvia o total DECLARADO, que é nulo quando o
 *     documento não declara nenhum — e o painel exige valor por linha. Agora
 *     devolve também a soma que a extração leu, calculada em SQL com a regra do
 *     domínio (pagamento de fatura não compõe o total).
 *
 *  2. Nenhuma forma de painel aceitava a lista: as quatro que caberiam exigem
 *     `transactionIds` de toda linha com valor, e o total de uma fatura é fato
 *     do documento. Sobrava `commitments`, que desenharia "Agenda" sobre um
 *     histórico. Daí o silêncio: painel reprovado de um lado, proibição de
 *     despejar número no chat do outro.
 *
 * E a série de GASTO mês a mês, que é a outra leitura da mesma frase, não tinha
 * tool nenhuma: `aggregate_by_category` recorta um período, `compare_periods`
 * compara dois. A conta cruzada por operadora e mês existia no domínio e só a
 * tela alcançava.
 */

let tenantId: string;
let ctx: never;

describe("o histórico de faturas e a série mês a mês", () => {
  before(async () => {
    tenantId = await freshTenant();
    ctx = ctxFor(tenantId);

    // Duas faturas de ciclos diferentes, uma DECLARANDO o total e a outra não —
    // o caso que deixava a linha sem valor. Os gastos caem em meses distintos
    // de propósito: o mês da série é o da COMPRA, não o do fechamento.
    const first = await seedDocument(tenantId, { filename: "abril.pdf", issuer: "Nubank" });
    const declared = (await proposeBatch.execute(
      {
        documentId: first,
        declaredTotal: 30_000,
        periodStart: "2026-03-31",
        periodEnd: "2026-04-30",
        dueDate: "2026-05-07",
        transactions: [
          {
            date: "2026-04-10",
            originalDescription: "MERCADO ABRIL",
            merchant: "Mercado",
            amount: 20_000,
            kind: "purchase",
            category: "groceries",
            extractionConfidence: "alta",
          },
          {
            date: "2026-04-20",
            originalDescription: "PADARIA ABRIL",
            merchant: "Padaria",
            amount: 10_000,
            kind: "purchase",
            category: "groceries",
            extractionConfidence: "alta",
          },
        ],
      },
      ctx,
    )) as { batchId: string; error?: unknown };
    assert.equal(declared.error, undefined);
    await commitBatch.execute({ batchId: declared.batchId }, ctx);

    const second = await seedDocument(tenantId, { filename: "maio.pdf", issuer: "Itaú" });
    const undeclared = (await proposeBatch.execute(
      {
        documentId: second,
        // Sem `declaredTotal`: o documento não afirma total nenhum.
        periodStart: "2026-04-30",
        periodEnd: "2026-05-31",
        dueDate: "2026-06-07",
        transactions: [
          {
            date: "2026-05-15",
            originalDescription: "RESTAURANTE MAIO",
            merchant: "Restaurante",
            amount: 15_000,
            kind: "purchase",
            category: "dining",
            extractionConfidence: "alta",
          },
          {
            date: "2026-05-02",
            originalDescription: "PAGTO FATURA ANTERIOR",
            merchant: null,
            amount: -30_000,
            kind: "payment",
            extractionConfidence: "alta",
          },
        ],
      },
      ctx,
    )) as { batchId: string; error?: unknown };
    assert.equal(undeclared.error, undefined);
    await commitBatch.execute({ batchId: undeclared.batchId }, ctx);
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  it("toda fatura tem um valor para mostrar, inclusive a que não declara total", async () => {
    const invoices = (await listInvoices.execute({ oldestFirst: true }, ctx)) as Array<{
      invoiceLabel: string;
      declaredTotalCents: number | null;
      extractedTotalCents: number;
      totalToShow: number;
      transactionCount: number;
    }>;

    assert.equal(invoices.length, 2);
    // Ordem cronológica: "mês a mês" lido de trás para frente não é série.
    assert.deepEqual(
      invoices.map((invoice) => invoice.invoiceLabel),
      ["Nubank 07/05/26", "Itaú 07/06/26"],
    );

    const [abril, maio] = invoices;
    assert.equal(abril?.declaredTotalCents, 30_000);
    assert.equal(abril?.extractedTotalCents, 30_000);
    assert.equal(abril?.totalToShow, 30_000);

    // Aqui morava o buraco: sem total declarado, a linha não tinha valor nenhum.
    assert.equal(maio?.declaredTotalCents, null);
    // R$ 150,00 de gasto — o pagamento de R$ 300,00 NÃO compõe o total da
    // fatura, pela mesma regra do domínio que a conferência usa.
    assert.equal(maio?.extractedTotalCents, 15_000);
    assert.equal(maio?.totalToShow, 15_000);
    assert.equal(maio?.transactionCount, 2);
  });

  it("o histórico vira painel sem inventar proveniência", async () => {
    const invoices = (await listInvoices.execute({ oldestFirst: true }, ctx)) as Array<{
      invoiceLabel: string;
      totalToShow: number;
      periodStart: string | null;
      periodEnd: string | null;
    }>;

    // É este o mapeamento que a coordenadora faz: rótulo, valor da tool, ciclo
    // no detalhe. Nenhum id — e é justamente por isso que antes não passava.
    const result = parseViewResult({
      kind: "invoices",
      title: "Faturas mês a mês",
      rows: invoices.map((invoice) => ({
        label: invoice.invoiceLabel,
        amount: invoice.totalToShow,
        detail: `ciclo ${invoice.periodStart} – ${invoice.periodEnd}`,
      })),
    });

    assert.equal(result.ok, true);
  });

  it("a série mês a mês vem em uma chamada, com proveniência em cada mês", async () => {
    const series = (await aggregateByMonth.execute({}, ctx)) as {
      months: Array<{
        month: string;
        label: string;
        cents: number;
        count: number;
        transactionIds: string[];
        byIssuer: Array<{ label: string; cents: number }>;
      }>;
      total: { cents: number };
      note: string;
    };

    // Dois meses de COMPRA, do mais antigo para o mais recente — e maio existe
    // como mês próprio, não colado no fechamento da fatura de junho.
    assert.deepEqual(
      series.months.map((month) => month.month),
      ["2026-04", "2026-05"],
    );
    assert.equal(series.months[0]?.label, "abril de 2026");
    assert.equal(series.months[0]?.cents, 30_000);
    assert.equal(series.months[1]?.cents, 15_000);

    // Proveniência em toda linha: é o que permite ao painel existir.
    assert.equal(series.months[0]?.transactionIds.length, 2);
    assert.equal(series.months[1]?.transactionIds.length, 1);

    // O pagamento de R$ 300,00 não entra em mês nenhum.
    assert.equal(series.total.cents, 45_000);

    // E a composição por operadora dentro do mês.
    assert.deepEqual(
      series.months[1]?.byIssuer.map((row) => row.label),
      ["Itaú"],
    );
  });

  it("a série cabe num painel de composição, com os ids que a tool devolveu", async () => {
    const series = (await aggregateByMonth.execute({}, ctx)) as {
      months: Array<{ label: string; cents: number; transactionIds: string[] }>;
    };

    const result = parseViewResult({
      kind: "breakdown",
      title: "Gasto mês a mês",
      rows: series.months.map((month) => ({
        label: month.label,
        amount: month.cents,
        transactionIds: month.transactionIds,
      })),
    });

    assert.equal(result.ok, true);
  });

  it("recorte sem lançamentos diz o que o razão cobre, em vez de somar zero", async () => {
    const empty = (await aggregateByMonth.execute(
      { from: "2026-08-01", to: "2026-08-31" },
      ctx,
    )) as { empty?: true; message?: string; ledgerCoverage?: { count: number } };

    assert.equal(empty.empty, true);
    assert.equal(empty.ledgerCoverage?.count, 4);
    assert.match(empty.message ?? "", /razão cobre/);
  });
});
