import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchRules, parseRules, type RuleCandidate, type RuleTarget } from "./rules";

/**
 * O ciclo da hipótese H4 só fecha se a regra aprendida realmente alcançar os
 * lançamentos. Estes testes cobrem o que já quebrou na prática: frontmatter
 * sem `merchant`, corpo sem link, e descrição com parcela — em que o texto
 * varia todo mês e um casamento ingênuo por igualdade nunca pega.
 */

function rule(partial: Partial<RuleCandidate> = {}): RuleCandidate {
  return {
    conceptId: partial.conceptId ?? "rules/nuvem-digital",
    frontmatter: partial.frontmatter ?? { merchant: "Nuvem Digital" },
    body: partial.body ?? "Aplica-se a [Assinaturas](/categories/subscriptions.md).",
  };
}

function target(partial: Partial<RuleTarget> = {}): RuleTarget {
  return {
    id: partial.id ?? "t1",
    merchant: partial.merchant ?? null,
    originalDescription: partial.originalDescription ?? "NUVEM DIGITAL LTDA",
  };
}

describe("parseRules", () => {
  it("extrai a categoria do link markdown e normaliza o matcher", () => {
    const [parsed] = parseRules([rule()]);
    assert.equal(parsed?.category, "subscriptions");
    assert.equal(parsed?.matcher, "nuvem digital");
  });

  it("cai para o title quando não há merchant", () => {
    const [parsed] = parseRules([
      rule({ frontmatter: { title: "Padaria Central" } }),
    ]);
    assert.equal(parsed?.matcher, "padaria central");
  });

  it("descarta regra sem link de categoria em vez de derrubar o lote", () => {
    const parsed = parseRules([
      rule({ conceptId: "rules/quebrada", body: "Sem link nenhum." }),
      rule(),
    ]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.conceptId, "rules/nuvem-digital");
  });

  it("descarta matcher vazio — casaria com tudo", () => {
    assert.deepEqual(parseRules([rule({ frontmatter: { merchant: "   " } })]), []);
  });
});

describe("matchRules", () => {
  it("casa por trecho, então parcela e data não atrapalham", () => {
    const rules = parseRules([rule()]);
    const matches = matchRules(rules, [
      target({ id: "t1", originalDescription: "NUVEM DIGITAL LTDA 03/12" }),
    ]);

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.category, "subscriptions");
    // A proveniência acompanha o casamento: sem o conceito de origem, desfazer
    // a regra depois seria desfazer às cegas.
    assert.equal(matches[0]?.byConceptId, "rules/nuvem-digital");
  });

  it("considera merchant e descrição", () => {
    const rules = parseRules([rule()]);
    const matches = matchRules(rules, [
      target({ merchant: "Nuvem Digital", originalDescription: "PAGSEGURO *ND" }),
    ]);
    assert.equal(matches.length, 1);
  });

  it("não casa o que não é da regra", () => {
    const rules = parseRules([rule()]);
    assert.deepEqual(matchRules(rules, [target({ originalDescription: "UBER TRIP" })]), []);
  });

  it("a primeira regra vence, para o resultado ser previsível", () => {
    const rules = parseRules([
      rule({
        conceptId: "rules/especifica",
        frontmatter: { merchant: "nuvem digital pro" },
        body: "Aplica-se a [Software](/categories/software.md).",
      }),
      rule(),
    ]);
    const matches = matchRules(rules, [
      target({ originalDescription: "NUVEM DIGITAL PRO" }),
    ]);
    assert.equal(matches[0]?.category, "software");
  });

  it("sem regra alguma, não mexe em nada", () => {
    assert.deepEqual(matchRules([], [target()]), []);
  });
});
