import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { FrontmatterSchema, type Concept, type Frontmatter } from "./types";

const FRONTMATTER_DELIMITER = "---";

export class OkfParseError extends Error {}

/**
 * Lê um conceito OKF: frontmatter YAML entre `---`, seguido do corpo markdown.
 *
 * Estrito onde o SPEC é estrito (frontmatter parseável, `type` não-vazio) e
 * tolerante onde ele manda tolerar (§11: chaves desconhecidas são preservadas,
 * nunca motivo de rejeição).
 */
export function parseConcept(id: string, raw: string): Concept {
  const text = raw.replace(/^﻿/, "");

  if (!text.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    throw new OkfParseError(`Conceito "${id}": frontmatter YAML ausente (deve começar com ---).`);
  }

  const end = text.indexOf(`\n${FRONTMATTER_DELIMITER}`, FRONTMATTER_DELIMITER.length);
  if (end === -1) {
    throw new OkfParseError(`Conceito "${id}": frontmatter não fechado.`);
  }

  const yamlSource = text.slice(FRONTMATTER_DELIMITER.length + 1, end);
  // Come TODAS as linhas em branco após o `---` de fechamento. Uma só não
  // basta: a separação entre frontmatter e corpo é convenção de formatação,
  // não conteúdo, e mantê-la faria o round-trip acumular linhas a cada volta.
  const body = text.slice(end + FRONTMATTER_DELIMITER.length + 1).replace(/^\n+/, "");

  let data: unknown;
  try {
    data = parseYaml(yamlSource);
  } catch (cause) {
    throw new OkfParseError(
      `Conceito "${id}": frontmatter YAML inválido — ${(cause as Error).message}`,
    );
  }

  const result = FrontmatterSchema.safeParse(data ?? {});
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`)
      .join("; ");
    throw new OkfParseError(`Conceito "${id}": frontmatter inválido — ${detail}`);
  }

  return { id, frontmatter: result.data, body: body.trimEnd() };
}

/** Serializa de volta para o arquivo `.md`. */
export function serializeConcept(concept: Concept): string {
  const frontmatter = stringifyYaml(orderKeys(concept.frontmatter), { lineWidth: 0 }).trimEnd();
  return `${FRONTMATTER_DELIMITER}\n${frontmatter}\n${FRONTMATTER_DELIMITER}\n\n${concept.body.trimEnd()}\n`;
}

/**
 * Ordena as chaves conhecidas primeiro, mantendo as demais depois.
 * Só estética — o formato não exige ordem —, mas mantém os diffs legíveis,
 * que é metade do valor de guardar conhecimento como texto.
 */
const KEY_ORDER = [
  "type",
  "title",
  "description",
  "resource",
  "tags",
  "status",
  "stale_after",
  "sources",
  "generated",
  "verified",
];

function orderKeys(frontmatter: Frontmatter): Record<string, unknown> {
  const entries = Object.entries(frontmatter);
  const known = KEY_ORDER.flatMap((key) => {
    const found = entries.find(([name]) => name === key);
    return found ? [found] : [];
  });
  const rest = entries.filter(([name]) => !KEY_ORDER.includes(name));
  return Object.fromEntries([...known, ...rest]);
}

/**
 * §6.1 — cross-links são markdown COMUM, não wikilinks: `/absoluto.md` a
 * partir da raiz do bundle (recomendado) ou `./relativo.md`.
 * Devolve os IDs de conceito referenciados, sem o `.md`.
 */
export function extractLinks(concept: Concept): string[] {
  const links = new Set<string>();
  const pattern = /\[[^\]]*\]\((\.{0,2}\/[^)\s]+\.md)\)/g;

  for (const match of concept.body.matchAll(pattern)) {
    const target = match[1];
    if (target === undefined) continue;
    links.add(normalizeLink(concept.id, target));
  }

  return [...links];
}

function normalizeLink(fromId: string, target: string): string {
  const withoutExtension = target.replace(/\.md$/, "");

  if (withoutExtension.startsWith("/")) return withoutExtension.slice(1);

  const fromDirectory = fromId.includes("/") ? fromId.slice(0, fromId.lastIndexOf("/")) : "";
  const segments = withoutExtension.replace(/^\.\//, "").split("/");
  const resolved = fromDirectory ? fromDirectory.split("/") : [];

  for (const segment of segments) {
    if (segment === "..") resolved.pop();
    else if (segment !== ".") resolved.push(segment);
  }

  return resolved.join("/");
}
