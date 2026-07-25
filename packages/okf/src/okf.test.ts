import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractLinks, OkfParseError, parseConcept, serializeConcept } from "./concept";
import { isConformant, validateBundle } from "./validate";
import type { Concept } from "./types";

const RULE = `---
type: CategorizationRule
title: Nuvem Digital → Assinaturas
status: stable
generated:
  by: clara/coordinator@0.1
  at: 2026-07-25T14:02:11Z
verified:
  - by: human:usr_123
    at: 2026-07-25T14:02:40Z
---

Transações da Nuvem Digital viram [Assinaturas](/categories/subscriptions.md).
`;

describe("parseConcept", () => {
  it("lê frontmatter e corpo", () => {
    const concept = parseConcept("learnings/nuvem-digital", RULE);

    assert.equal(concept.frontmatter.type, "CategorizationRule");
    assert.equal(concept.frontmatter.status, "stable");
    assert.equal(concept.frontmatter.generated?.by, "clara/coordinator@0.1");
    assert.equal(concept.frontmatter.verified?.[0]?.by, "human:usr_123");
    assert.match(concept.body, /Nuvem Digital/);
  });

  it("preserva chaves desconhecidas, como o §11 exige", () => {
    const concept = parseConcept(
      "x",
      "---\ntype: Category\ncampoInventado: valor\n---\n\ncorpo\n",
    );
    assert.equal(concept.frontmatter.campoInventado, "valor");
  });

  it("aceita conceito só com `type` — é conformante por si só", () => {
    const concept = parseConcept("x", "---\ntype: Category\n---\n\ncorpo\n");
    assert.equal(concept.frontmatter.type, "Category");
  });

  it("recusa frontmatter ausente", () => {
    assert.throws(() => parseConcept("x", "sem frontmatter\n"), OkfParseError);
  });

  it("recusa `type` vazio ou ausente", () => {
    assert.throws(() => parseConcept("x", "---\ntitle: sem tipo\n---\n\ncorpo\n"), OkfParseError);
    assert.throws(() => parseConcept("x", '---\ntype: ""\n---\n\ncorpo\n'), OkfParseError);
  });
});

describe("serializeConcept", () => {
  it("faz round-trip sem perder dado", () => {
    const original = parseConcept("learnings/nuvem-digital", RULE);
    const round = parseConcept("learnings/nuvem-digital", serializeConcept(original));

    assert.deepEqual(round.frontmatter, original.frontmatter);
    assert.equal(round.body, original.body);
  });

  it("põe `type` primeiro, para o diff ficar legível", () => {
    const output = serializeConcept({
      id: "x",
      frontmatter: { zzz: "ultimo", type: "Category", title: "Mercado" },
      body: "corpo",
    });
    assert.match(output, /^---\ntype: Category\ntitle: Mercado\n/);
  });
});

describe("extractLinks", () => {
  it("resolve link absoluto a partir da raiz do bundle", () => {
    const concept = parseConcept("learnings/x", RULE);
    assert.deepEqual(extractLinks(concept), ["categories/subscriptions"]);
  });

  it("resolve link relativo ao diretório do conceito", () => {
    const concept: Concept = {
      id: "categories/groceries",
      frontmatter: { type: "Category" },
      body: "veja [vizinho](./restaurants.md) e [acima](../conventions/schema.md)",
    };
    assert.deepEqual(extractLinks(concept), ["categories/restaurants", "conventions/schema"]);
  });

  it("ignora wikilinks — não são sintaxe OKF", () => {
    const concept: Concept = {
      id: "x",
      frontmatter: { type: "Category" },
      body: "isto [[nao-e-link]] no OKF",
    };
    assert.deepEqual(extractLinks(concept), []);
  });
});

describe("validateBundle", () => {
  const groceries: Concept = {
    id: "categories/groceries",
    frontmatter: { type: "Category" },
    body: "Compras de supermercado.",
  };

  it("aprova bundle conformante", () => {
    assert.ok(isConformant(validateBundle([groceries])));
  });

  it("trata link quebrado como AVISO, nunca erro (§11)", () => {
    const issues = validateBundle([
      { ...groceries, body: "veja [sumiu](/categories/inexistente.md)" },
    ]);

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.severity, "warning");
    assert.ok(isConformant(issues), "link quebrado não pode desqualificar o bundle");
  });

  it("acusa ID duplicado", () => {
    const issues = validateBundle([groceries, groceries]);
    assert.ok(issues.some((issue) => issue.severity === "error"));
  });
});
