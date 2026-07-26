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

  it("identificador técnico não aparece para a pessoa", async () => {
    const prompt = await read("../agent/instructions.md");
    assert.match(prompt, /Identifiers are never shown to the person/i);
    assert.match(prompt, /`batchId`, `documentId`,\s+`transactionId` nor `proposalId`/is);
  });
});
