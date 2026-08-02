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
    assert.match(analyst, /return that View unchanged/i);
    assert.match(coordinator, /call `present_analysis`/i);
    assert.match(coordinator, /rollout fallback.+`present_view`/is);
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
  });
});
