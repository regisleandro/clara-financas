import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("contratos de interação dos prompts", () => {
  it("a coordenadora distingue rascunho de escrita durável", async () => {
    const prompt = await read("../agent/instructions.md");
    assert.match(prompt, /durable semantic write/i);
    assert.match(prompt, /Draft extraction is the deliberate exception/i);
  });

  it("aprovação acontece no cartão, sem um sim duplicado em prosa", async () => {
    const prompt = await read("../agent/instructions.md");
    assert.match(prompt, /do not ask for a prose "sim"/i);

    const commit = await read("../agent/tools/commit_batch.ts");
    assert.match(commit, /the call opens the approval card/i);
    assert.match(commit, /Do not ask for a prose confirmation first/i);
  });

  it("senha de PDF usa pergunta livre protegida", async () => {
    const prompt = await read("../agent/instructions.md");
    assert.match(prompt, /ask_question/);
    assert.match(prompt, /allowFreeform: true/);
    assert.match(prompt, /never ask the person.+ordinary chat message/is);
    assert.match(prompt, /opaque, encrypted, short-lived credential/i);

    const reader = await read("../agent/subagents/extractor/tools/read_pdf_pages.ts");
    assert.match(reader, /openSealedInput/);
    assert.match(reader, /passwordToken/);
  });

  it("cada subagente declara um output estruturado", async () => {
    for (const name of ["extractor", "analyst", "categorizer"]) {
      const source = await read(`../agent/subagents/${name}/agent.ts`);
      assert.match(source, /outputSchema:/);
    }
  });

  it("referências relativas de fatura passam pelo foco persistido", async () => {
    const prompt = await read("../agent/instructions.md");
    assert.match(prompt, /resolve_invoice_reference\(active\)/);
    assert.match(prompt, /resolve_invoice_reference\(latest\)/);
    assert.match(prompt, /resolve_invoice_reference\(next_with_divergence\)/);
    assert.match(prompt, /Never choose a batch.+transcript/is);
    assert.match(prompt, /idempotent/i);
    assert.match(prompt, /skipActive/);
  });

  it("o resultado de ferramenta vence o estado lido no início do turno", async () => {
    const prompt = await read("../agent/instructions.md");
    assert.match(prompt, /tool result from this turn always beats/i);
    assert.match(prompt, /activeInvoiceAtTurnStart/);

    const snapshot = await read("../agent/lib/snapshot.ts");
    assert.match(snapshot, /PRECEDÊNCIA/);
    assert.match(snapshot, /activeInvoiceAtTurnStart/);
  });

  it("o estado do razão não oferece id de lançamento", async () => {
    const prompt = await read("../agent/instructions.md");
    assert.match(prompt, /No id in that block is an entry id/i);

    const snapshot = await read("../agent/lib/snapshot.ts");
    assert.match(snapshot, /TIPO DOS IDS/);
    assert.match(snapshot, /só existe no retorno de `read_batch`/);
  });

  it("alvo inválido não cancela o fechamento da divergência", async () => {
    const prepare = await read("../agent/tools/prepare_invoice_resolution.ts");
    assert.match(prepare, /is IGNORED and reported back in targetIgnored/);
    assert.doesNotMatch(prepare, /lancamento_nao_encontrado/);

    const prompt = await read("../agent/instructions.md");
    assert.match(prompt, /the tool\s+ignores it and returns `targetIgnored`/is);
  });

  /**
   * O estado do razão diz QUANTOS estão sem categoria; nada dizia como ver
   * QUAIS. A coordenadora delegava ao guarda-livros — que agrupa por
   * comerciante para propor categoria, não para listar — e a conversa terminava
   * em "a consulta não veio pronta", com a tool que responde a pergunta ao
   * alcance dela e sem uma linha de instrução apontando para lá.
   */
  it("ver os lançamentos sem categoria é uma chamada da coordenadora, não uma delegação", async () => {
    const prompt = await read("../agent/instructions.md");
    assert.match(prompt, /list_review_queue/);
    assert.match(prompt, /reasons: \["sem_categoria"\]/);
    assert.match(prompt, /includeReviewed: true/);
    assert.match(prompt, /COUNT of uncategorised spending, never the entries/i);
    assert.match(prompt, /never say a query "não retornou"/i);

    const queue = await read("../agent/tools/list_review_queue.ts");
    assert.match(queue, /includeReviewed/);
    assert.match(queue, /uncategorizedSpending/);
  });

  /**
   * "Liste as faturas mês a mês" e "quanto gastei mês a mês" são a mesma frase
   * com dois destinos. Sem a distinção escrita, a coordenadora delegava o
   * histórico ao analista — que não tem tool de fatura — ou tentava um painel
   * que a validação recusa, e a resposta não saía.
   */
  it('"mês a mês" tem dois caminhos, e os dois estão escritos', async () => {
    const prompt = await read("../agent/instructions.md");
    assert.match(prompt, /`invoices` — the invoice history/);
    assert.match(prompt, /oldestFirst: true/);
    assert.match(prompt, /aggregate_by_month/);
    // A saída para o painel reprovado: nunca ficar em silêncio.
    assert.match(prompt, /never acceptable is going\s+silent/is);

    const analyst = await read("../agent/subagents/analyst/instructions.md");
    assert.match(analyst, /aggregate_by_month/);
    assert.match(analyst, /uma chamada só/);

    // É pela `description` do subagente que o pai decide delegar.
    const agent = await read("../agent/subagents/analyst/agent.ts");
    assert.match(agent, /month-by-month series/);
    assert.match(agent, /list_invoices/);
  });

  it("a triagem do guarda-livros carrega o valor de cada grupo", async () => {
    const prompt = await read("../agent/subagents/categorizer/instructions.md");
    assert.match(prompt, /`count` and `totalCents`/);
    assert.match(prompt, /Never add money\s+up yourself/is);

    // O valor tem de existir na TOOL antes de existir no contrato: o modelo
    // copia, não soma.
    const rules = await read("../agent/subagents/categorizer/tools/categorize_by_rules.ts");
    assert.match(rules, /totalCents/);
  });

  it("identificador técnico não aparece para a pessoa", async () => {
    const prompt = await read("../agent/instructions.md");
    assert.match(prompt, /Identifiers are never shown to the person/i);
    assert.match(prompt, /`batchId`, `documentId`,\s+`transactionId` nor `proposalId`/is);
  });
});
