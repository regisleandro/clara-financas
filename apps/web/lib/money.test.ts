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
