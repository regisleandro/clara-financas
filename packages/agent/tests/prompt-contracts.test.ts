import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
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
    // `\s+` e não espaço literal: a frase quebra de linha conforme o parágrafo
    // é reescrito, e um teste que falha por reflow verifica formatação, não
    // conteúdo.
    assert.match(prompt, /do not ask for a\s+prose "sim"/i);

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

  it("agentes financeiros não recebem ferramentas genéricas de workspace ou web", async () => {
    const forbidden = [
      "agent",
      "bash",
      "glob",
      "grep",
      "read_file",
      "todo",
      "web_fetch",
      "web_search",
      "write_file",
    ];
    for (const directory of [
      "../agent/tools",
      "../agent/subagents/analyst/tools",
      "../agent/subagents/categorizer/tools",
      "../agent/subagents/extractor/tools",
    ]) {
      const files = await readdir(new URL(directory, import.meta.url));
      for (const name of forbidden) assert.ok(files.includes(`${name}.ts`), `${directory}/${name}`);
    }
  });

  it("análise preserva escopo vazio e atravessa agentes só por recibo", async () => {
    const analyst = await read("../agent/subagents/analyst/instructions.md");
    const coordinator = await read("../agent/instructions.md");
    assert.match(analyst, /current calendar month/i);
    assert.match(analyst, /Never\s+replace an empty requested scope/i);
    assert.match(analyst, /When the tool returns the declared `AnalysisReceipt`/i);
    // A instrução "durante off/shadow/canary devolva a View" saiu junto com a
    // máquina de rollout: não havia mais um caminho para ela descrever, e um
    // prompt que ensina uma forma inexistente é o mesmo defeito do `artifactIds`
    // fantasma, só que na direção oposta.
    assert.match(analyst, /concatenate the ids you received/i);
    assert.match(coordinator, /call `present_analysis`/i);
    /*
     * A regex que conferia a frase "mandatory control flow" saiu daqui.
     *
     * Ela testava que a DOCUMENTAÇÃO existe, não que a regra vale — e a regra
     * não valia: o modelo podia receber o recibo e encerrar o turno, e nada
     * acusava. Quem cobre isso agora é `tools/telemetry.test.ts`, com o
     * comportamento: recibo entregue e turno encerrado sem `present_*` vira o
     * evento `recibo_nao_apresentado`.
     *
     * Imposição dura não existe neste framework (hooks são observe-only,
     * `defineDynamic` não assina `action.result`), então a instrução continua
     * no prompt — mas a verificação passou a ser de efeito, não de texto.
     */
    assert.match(coordinator, /`proposalCount: 0` still requires/is);
    assert.match(coordinator, /SAME requested scope/i);
    assert.doesNotMatch(coordinator, /redo the query ONCE over the reported interval/i);
  });

  it("toda correção de categoria usa o cartão", async () => {
    const coordinator = await read("../agent/instructions.md");
    assert.match(coordinator, /Every category correction, including ONE entry/i);
    const tools = await readdir(new URL("../agent/tools", import.meta.url));
    assert.ok(!tools.includes("set_transaction_category.ts"));
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

  /*
   * A regra é cobrada onde o modelo a LÊ, e não onde ela foi escrita primeiro.
   *
   * Esta asserção existia em duplicata: na `description` da tool e numa frase do
   * prompt. Quando o prompt encolheu (a regra de tool voltou para a tool), o
   * teste ficou vermelho sem que nada tivesse piorado — ele media a localização
   * do texto, não a chegada dele. A descrição da tool viaja junto da chamada,
   * então é a superfície certa para cobrar.
   */
  it("alvo inválido não cancela o fechamento da divergência", async () => {
    const prepare = await read("../agent/tools/prepare_invoice_resolution.ts");
    assert.match(prepare, /is IGNORED and reported back in targetIgnored/);
    assert.match(prepare, /targetTransactionId is optional/i);
    assert.doesNotMatch(prepare, /lancamento_nao_encontrado/);
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
    // O roteamento entre os dois caminhos é JUÍZO do coordenador e fica no
    // prompt; como preencher cada painel é contrato e fica no schema.
    assert.match(prompt, /HISTORY OF\s+INVOICES/is);
    assert.match(prompt, /SPEND SERIES/);
    assert.match(prompt, /aggregate_by_month/);

    const contrato = await read("../../views/src/index.ts");
    assert.match(contrato, /The invoice history, one row per invoice/);
    assert.match(contrato, /oldestFirst: true/);
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
    assert.match(prompt, /`count` e `totalCents`/);
    assert.match(prompt, /Nunca some dinheiro/i);

    // Antes do prompt, o SCHEMA: os dois campos são obrigatórios em cada grupo,
    // então uma triagem sem peso nem chega a ser uma resposta válida.
    const contrato = await read("../../views/src/agent-contracts.ts");
    assert.match(contrato, /Never add it up yourself/i);

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

  /**
   * A taxonomia CRESCE, e a extração precisa saber disso.
   *
   * O coordenador lia as categorias só do bundle `constitution`. Categoria que
   * a Clara criou vive em `learnings` — então `entertainment`, aprovada há uma
   * semana, nunca era oferecida ao extrator, e o mesmo gasto voltava sem
   * categoria a cada fatura. A instrução até dizia "porque a taxonomia desta
   * pessoa cresce"; ela só lia o lugar errado.
   */
  it("a taxonomia oferecida ao extrator inclui o que a pessoa aprovou depois", async () => {
    const prompt = await read("../agent/instructions.md");
    assert.match(prompt, /\*\*both\*\* bundles/i);
    assert.match(prompt, /`learnings` holds every category this person approved/i);

    // E a fronteira derruba o que não existe, em vez de gravar a invenção.
    const escrita = await read("../agent/lib/write-proposed-batch.ts");
    assert.match(escrita, /loadValidCategories/);
    assert.match(escrita, /droppedCategories/);
  });
});
