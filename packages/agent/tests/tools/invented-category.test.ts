import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { getDb } from "@clara-financas/db";
import { transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { eq } from "drizzle-orm";

import proposeBatch from "../../agent/tools/propose_batch";
import { closeConnections, ctxFor, dropTenant, freshTenant, seedDocument } from "../helpers/harness";

/**
 * "As categorias continuam em inglês na produção."
 *
 * O identificador é inglês por convenção de código (`groceries`); o nome que a
 * pessoa lê vem do `title` do conceito ("Mercado"). Quando o conceito existe,
 * ninguém vê o id. O que apareceu em produção foram categorias SEM conceito —
 * `services`, `other`, `education` —, e aí `categoryLabel` cai no próprio
 * identificador.
 *
 * Elas entraram pela extração. O extrator já tinha a regra escrita ("you never
 * invent a category; if none fits, leave it null"), mas nada a impunha:
 * `propose_batch` aceitava `category: z.string()` cru e gravava o que viesse.
 * Regra em prosa, sem gate — que é como todos os outros defeitos desta semana
 * também começaram.
 *
 * Pior que o nome feio: `aggregateByCategory` passa a somar uma fatia que a
 * pessoa nunca aprovou, e a composição ganha uma linha que ninguém sabe de onde
 * saiu. O produto foi desenhado para a taxonomia ser inferida e aprovada pela
 * pessoa (commit f33e977, "taxonomia fixa era erro de desenho") — gravar a
 * invenção pula exatamente a etapa em que ela decide.
 */

let tenantId: string;
let ctx: never;

describe("categoria inventada não entra no razão", () => {
  before(async () => {
    tenantId = await freshTenant();
    ctx = ctxFor(tenantId);
  });

  after(async () => {
    await dropTenant(tenantId);
    await closeConnections();
  });

  it("a que existe na constituição passa; a inventada vira null", async () => {
    const documentId = await seedDocument(tenantId, { filename: "com-invencao.pdf" });

    const result = (await proposeBatch.execute(
      {
        documentId,
        declaredTotal: 30_000,
        periodStart: "2026-03-31",
        periodEnd: "2026-04-30",
        transactions: [
          {
            date: "2026-04-02",
            originalDescription: "MERCADO CENTRAL",
            merchant: "Mercado Central",
            amount: 10_000,
            kind: "purchase",
            category: "groceries",
            extractionConfidence: "alta",
          },
          {
            date: "2026-04-05",
            originalDescription: "ENCANADOR",
            merchant: "Encanador",
            amount: 12_000,
            kind: "purchase",
            // Não existe na constituição desta pessoa. Foi assim que
            // `services` chegou a 37 lançamentos em produção.
            category: "services",
            extractionConfidence: "media",
          },
          {
            date: "2026-04-09",
            originalDescription: "CURSO ONLINE",
            merchant: "Curso",
            amount: 8_000,
            kind: "purchase",
            category: "education",
            extractionConfidence: "media",
          },
        ],
      },
      ctx,
    )) as { batchId: string; droppedCategories?: { categories: string[]; note: string } };

    const gravadas = await forTenant(
      tenantId,
      (tx) =>
        tx
          .select({ description: transactions.originalDescription, category: transactions.category })
          .from(transactions)
          .where(eq(transactions.batchId, result.batchId)),
      getDb(),
    );
    const porDescricao = new Map(gravadas.map((row) => [row.description, row.category]));

    assert.equal(porDescricao.get("MERCADO CENTRAL"), "groceries", "a categoria válida fica");
    assert.equal(porDescricao.get("ENCANADOR"), null, "a inventada NÃO entra no razão");
    assert.equal(porDescricao.get("CURSO ONLINE"), null);
  });

  it("o descarte é anunciado, com o caminho para criar a categoria", async () => {
    const documentId = await seedDocument(tenantId, { filename: "anuncia.pdf" });

    const result = (await proposeBatch.execute(
      {
        documentId,
        declaredTotal: 5_000,
        periodStart: "2026-04-30",
        periodEnd: "2026-05-31",
        transactions: [
          {
            date: "2026-05-02",
            originalDescription: "PETSHOP",
            amount: 5_000,
            kind: "purchase",
            category: "cuidados_com_animais",
            extractionConfidence: "alta",
          },
        ],
      },
      ctx,
    )) as { droppedCategories?: { categories: string[]; note: string; hint: string } };

    // Zerar em silêncio trocaria um defeito visível (categoria estranha na
    // tela) por um invisível (linha que perdeu categoria sem ninguém saber).
    assert.ok(result.droppedCategories, "o descarte precisa aparecer no retorno");
    assert.deepEqual(result.droppedCategories.categories, ["cuidados_com_animais"]);
    assert.match(result.droppedCategories.hint, /save_concept/);
    assert.match(result.droppedCategories.hint, /português/i);
  });

  it("nada a descartar não polui o retorno", async () => {
    const documentId = await seedDocument(tenantId, { filename: "limpa.pdf" });

    const result = (await proposeBatch.execute(
      {
        documentId,
        declaredTotal: 4_000,
        periodStart: "2026-05-31",
        periodEnd: "2026-06-30",
        transactions: [
          {
            date: "2026-06-03",
            originalDescription: "RESTAURANTE",
            amount: 4_000,
            kind: "purchase",
            category: "dining",
            extractionConfidence: "alta",
          },
        ],
      },
      ctx,
    )) as { droppedCategories?: unknown };

    assert.equal(result.droppedCategories, undefined);
  });

  /**
   * O caminho pelo qual `categories/entertainment` chegou à tela: o modelo
   * manda o CAMINHO do conceito porque acabou de lê-lo. A forma não pode
   * decidir se a categoria é aceita — só a existência.
   */
  it("o caminho do conceito é aceito e gravado como slug", async () => {
    const documentId = await seedDocument(tenantId, { filename: "caminho.pdf" });

    const result = (await proposeBatch.execute(
      {
        documentId,
        declaredTotal: 7_000,
        periodStart: "2026-06-30",
        periodEnd: "2026-07-31",
        transactions: [
          {
            date: "2026-07-04",
            originalDescription: "FARMACIA",
            amount: 7_000,
            kind: "purchase",
            category: "categories/health",
            extractionConfidence: "alta",
          },
        ],
      },
      ctx,
    )) as { batchId: string; droppedCategories?: unknown };

    const [linha] = await forTenant(
      tenantId,
      (tx) =>
        tx
          .select({ category: transactions.category })
          .from(transactions)
          .where(eq(transactions.batchId, result.batchId)),
      getDb(),
    );

    assert.equal(linha?.category, "health", "grava o slug, não o caminho");
    assert.equal(result.droppedCategories, undefined, "não é invenção — a categoria existe");
  });
});
