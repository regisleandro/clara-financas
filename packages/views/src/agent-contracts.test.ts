import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AnalysisResultSchema, CategorizationResultSchema } from "./agent-contracts";

describe("contratos estruturados dos subagentes", () => {
  it("analista não pode devolver número sem proveniência", () => {
    const result = AnalysisResultSchema.safeParse({
      kind: "metric",
      title: "Total",
      summary: "Leitura do período.",
      metric: { label: "Total", amount: 1000, transactionIds: [] },
      rows: [],
      warnings: [],
    });
    assert.equal(result.success, false);
  });

  it("proposta de categoria exige id, rótulo, motivo e transações", () => {
    const result = CategorizationResultSchema.safeParse({
      matchedRules: [],
      proposals: [
        {
          merchant: "Padaria",
          categoryId: "groceries",
          categoryLabel: "Mercado",
          reason: "Compra de alimentação.",
          count: 1,
          totalCents: 3_997,
          transactionIds: ["txn_1"],
        },
      ],
      merchantAliases: [],
      warnings: [],
    });
    assert.equal(result.success, true);
  });

  /**
   * Os três casos que faltavam — e cuja ausência produziu, em produção, a
   * resposta "a consulta não retornou a estrutura necessária". Toda resposta
   * CERTA para uma fatura que não fecha era inválida pelo schema.
   */
  it("analista pode devolver a conferência de uma fatura", () => {
    const result = AnalysisResultSchema.safeParse({
      kind: "checksum",
      title: "Conferência da fatura",
      summary: "A soma dos lançamentos ficou 3 centavos acima do total declarado.",
      checksum: {
        batchId: "bat_1",
        declaredTotal: 438_792,
        extractedTotal: 438_795,
        difference: 3,
        result: "mismatch",
        cause: "Compatível com arredondamento do IOF.",
      },
      rows: [
        { label: "Total declarado", amount: 438_792 },
        { label: "Diferença", amount: 3, detail: "Não há item culpado." },
      ],
      warnings: [],
    });
    assert.equal(result.success, true);
  });

  it("conferência sem o objeto checksum é recusada", () => {
    const result = AnalysisResultSchema.safeParse({
      kind: "checksum",
      title: "Conferência",
      summary: "Falta o que sustenta a afirmação.",
      rows: [],
      warnings: [],
    });
    assert.equal(result.success, false);
  });

  it('"não encontrei nada neste recorte" é uma resposta válida', () => {
    const result = AnalysisResultSchema.safeParse({
      kind: "transactions",
      title: "Nada neste recorte",
      summary: "Não há lançamentos entre 01/07 e 31/07; o razão cobre 31/05 a 30/06.",
      warnings: [],
      ledgerCoverage: { count: 48, firstDate: "2026-05-31", lastDate: "2026-06-30" },
    });
    assert.equal(result.success, true);
    // `rows` era obrigatório: o modelo não tinha como dizer "vazio".
    assert.deepEqual(result.data?.rows, []);
  });

  /**
   * O mesmo defeito de estrutura, agora no guarda-livros — e o diálogo que ele
   * produziu, palavra por palavra:
   *
   *   — existem itens sem categoria
   *   — Sim. Há 2 itens sem categoria, somando R$ 79,94.
   *   — apresente esses itens
   *   — a consulta não retornou os 2 itens de forma confiável.
   *
   * Duas causas, as duas aqui: a triagem que só tinha propostas era REPROVADA
   * por omitir os arrays vazios, e nem a proposta válida tinha onde carregar o
   * valor de cada grupo — a coordenadora, proibida de calcular, recebia
   * comerciantes sem dinheiro nenhum e não tinha o que apresentar.
   */
  it("triagem só com propostas é válida sem os arrays vazios", () => {
    const result = CategorizationResultSchema.safeParse({
      proposals: [
        {
          merchant: "Sem identificação",
          categoryId: null,
          categoryLabel: null,
          reason: "A descrição não diz o suficiente para escolher uma categoria.",
          count: 2,
          totalCents: 7_994,
          transactionIds: ["txn_1", "txn_2"],
        },
      ],
      uncategorized: { count: 2, totalCents: 7_994 },
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.data?.matchedRules, []);
    assert.deepEqual(result.data?.merchantAliases, []);
    assert.deepEqual(result.data?.warnings, []);
  });

  it("proposta sem o peso do grupo é recusada", () => {
    const result = CategorizationResultSchema.safeParse({
      proposals: [
        {
          merchant: "Padaria",
          categoryId: "groceries",
          categoryLabel: "Mercado",
          reason: "Compra de alimentação.",
          transactionIds: ["txn_1"],
        },
      ],
    });
    assert.equal(result.success, false);
    const paths = result.error?.issues.map((issue) => issue.path.at(-1));
    assert.ok(paths?.includes("count"));
    assert.ok(paths?.includes("totalCents"));
  });

  it("regra casada também carrega quantos lançamentos e quanto somam", () => {
    const result = CategorizationResultSchema.safeParse({
      matchedRules: [
        {
          conceptId: "rules/spotify",
          categoryId: "subscriptions",
          categoryLabel: "Assinaturas",
          reason: "A regra aprendida de Spotify alcança estas linhas.",
          count: 3,
          totalCents: 6_990,
          transactionIds: ["txn_1", "txn_2", "txn_3"],
        },
      ],
    });
    assert.equal(result.success, true);
    assert.equal(result.data?.matchedRules[0]?.totalCents, 6_990);
  });

  it("proposta vazia continua exigindo pelo menos uma transação", () => {
    const result = CategorizationResultSchema.safeParse({
      proposals: [
        {
          merchant: "Padaria",
          categoryId: "groceries",
          categoryLabel: "Mercado",
          reason: "Compra de alimentação.",
          count: 1,
          totalCents: 3_997,
          transactionIds: [],
        },
      ],
    });
    assert.equal(result.success, false);
  });
});
