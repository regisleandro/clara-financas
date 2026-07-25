import { extractLinks } from "./concept";
import { RESERVED_FILENAMES, type Concept, type ValidationIssue } from "./types";

/**
 * Conformance do OKF §11 — e NADA além disso.
 *
 * O SPEC tem exatamente três regras, e é igualmente explícito sobre o que um
 * consumidor NÃO pode rejeitar: frontmatter opcional ausente, `type`
 * desconhecido, chaves extras, link quebrado ou `index.md` ausente.
 *
 * Por isso link quebrado sai como `warning`, nunca `error`. Endurecer isso
 * quebraria a interoperabilidade que é o ponto do formato.
 */
export function validateBundle(concepts: Concept[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set(concepts.map((concept) => concept.id));
  const seen = new Set<string>();

  for (const concept of concepts) {
    const filename = `${concept.id.split("/").pop() ?? ""}.md`;
    if ((RESERVED_FILENAMES as readonly string[]).includes(filename)) {
      continue; // reservados seguem §8/§9, não a regra de conceito
    }

    // Regra 2: `type` não-vazio. (A regra 1, frontmatter parseável, já foi
    // exercida pelo parseConcept — chegar aqui significa que passou.)
    if (typeof concept.frontmatter.type !== "string" || concept.frontmatter.type.trim() === "") {
      issues.push({
        conceptId: concept.id,
        severity: "error",
        message: "frontmatter `type` é obrigatório e não pode ser vazio (OKF §11).",
      });
    }

    if (seen.has(concept.id)) {
      issues.push({
        conceptId: concept.id,
        severity: "error",
        message: "ID de conceito duplicado no bundle.",
      });
    }
    seen.add(concept.id);

    for (const link of extractLinks(concept)) {
      if (!ids.has(link)) {
        issues.push({
          conceptId: concept.id,
          severity: "warning",
          message: `link para "${link}" não resolve. O §11 manda tolerar link quebrado — isto é aviso, não erro.`,
        });
      }
    }
  }

  return issues;
}

/** Verdadeiro quando o bundle é conforme (avisos não desqualificam). */
export function isConformant(issues: ValidationIssue[]): boolean {
  return !issues.some((issue) => issue.severity === "error");
}
