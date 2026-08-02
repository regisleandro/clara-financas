import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { displayArtifactValue, displayMetricValue } from "./money";

describe("dinheiro na interface", () => {
  it("converte centavos crus de uma métrica financeira histórica", () => {
    assert.equal(
      displayMetricValue({ label: "Valor", text: "5000000" }),
      "R$ 50.000,00",
    );
  });

  it("não transforma contagem em dinheiro", () => {
    assert.equal(displayMetricValue({ label: "Assinaturas", text: "6" }), "6");
  });

  it("prioriza amount e formata com duas casas", () => {
    assert.equal(displayMetricValue({ label: "Total", amount: 123456 }), "R$ 1.234,56");
  });

  it("normaliza valores crus do artefato legado", () => {
    assert.equal(displayArtifactValue("Diferença", "-500"), "-R$ 5,00");
  });
});

describe("basis manda, o rótulo não adivinha", () => {
  it("contagem declarada nunca vira moeda", () => {
    // "Total de assinaturas: 6" virava R$ 0,06 porque o rótulo casava
    // `\btotal\b` e o texto era um inteiro. A adivinhação acertava no caso
    // comum e errava exatamente onde a pessoa notaria.
    assert.equal(
      displayMetricValue({ label: "Total de assinaturas", text: "6", basis: "count" }),
      "6",
    );
  });

  it("painel que declara soma não é reinterpretado pelo rótulo", () => {
    assert.equal(
      displayMetricValue({ label: "Total da fatura", text: "6", basis: "sum" }),
      "6",
    );
  });

  it("artefato antigo, sem basis, mantém a compatibilidade de centavos crus", () => {
    // Uma sessão já persistida com `text: "5000000"` continuaria mostrando
    // centavos crus para sempre; é só para esses que a heurística sobrevive.
    assert.equal(displayMetricValue({ label: "Total da fatura", text: "5000000" }), "R$ 50.000,00");
  });
});
