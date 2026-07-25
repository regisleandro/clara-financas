import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { parseConcept } from "./concept";
import { RESERVED_FILENAMES, type Concept } from "./types";

/**
 * Lê um bundle OKF do disco.
 *
 * O ID do conceito é o caminho relativo à raiz do bundle sem `.md` (§3), então
 * `categories/groceries.md` vira `categories/groceries`. `index.md` e `log.md`
 * são reservados e não são conceitos.
 */
export async function loadBundle(root: string): Promise<Concept[]> {
  const files = await walk(root);
  const concepts: Concept[] = [];

  for (const file of files) {
    const relativePath = relative(root, file);
    const filename = relativePath.split(sep).pop() ?? "";
    if ((RESERVED_FILENAMES as readonly string[]).includes(filename)) continue;
    if (!filename.endsWith(".md")) continue;

    const id = relativePath.split(sep).join("/").replace(/\.md$/, "");
    concepts.push(parseConcept(id, await readFile(file, "utf8")));
  }

  return concepts.sort((a, b) => a.id.localeCompare(b.id));
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }

  return files;
}
