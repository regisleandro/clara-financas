import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { isConformant, loadBundle, validateBundle } from "@clara-financas/okf";
import { sql } from "drizzle-orm";

import { concepts } from "./schema/knowledge";
import { forTenant } from "./tenant-scope";
import type { Database } from "./index";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE_ROOT = resolve(HERE, "../../../bundles/constitution");

/**
 * Copia o bundle da constituição para o espaço de um tenant.
 *
 * Por que copiar em vez de referenciar um bundle global: cada tenant tem o
 * próprio espaço isolado, e o dia em que a taxonomia puder ser personalizada
 * essa cópia já é o ponto de extensão. Além disso a leitura fica sob RLS como
 * todo o resto, sem caminho especial.
 *
 * Idempotente: rodar duas vezes não duplica nem sobrescreve.
 */
export async function seedConstitution(
  tenantId: string,
  db?: Database,
): Promise<{ inserted: number; skipped: number }> {
  const bundle = await loadBundle(BUNDLE_ROOT);

  const issues = validateBundle(bundle);
  if (!isConformant(issues)) {
    const errors = issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => `${issue.conceptId}: ${issue.message}`)
      .join("\n");
    throw new Error(`Bundle da constituição não é conformante com o OKF:\n${errors}`);
  }

  return forTenant(
    tenantId,
    async (tx) => {
      let inserted = 0;
      let skipped = 0;

      for (const concept of bundle) {
        const result = await tx
          .insert(concepts)
          .values({
            id: `cpt_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
            tenantId,
            bundle: "constitution",
            conceptId: concept.id,
            type: concept.frontmatter.type,
            frontmatter: concept.frontmatter,
            body: concept.body,
          })
          .onConflictDoNothing()
          .returning({ id: concepts.id });

        if (result.length > 0) inserted += 1;
        else skipped += 1;
      }

      return { inserted, skipped };
    },
    db,
  );
}

/**
 * Versão da constituição = hash do conteúdo em disco.
 *
 * Existe porque a constituição é "alterada por edição direta no repositório",
 * e sem isto essa edição nunca chegava a quem já tinha conta: a semeadura só
 * rodava no nascimento do tenant. Na prática, acrescentei Pets, Compras e
 * Encargos ao bundle e a Clara seguia dizendo que essas categorias não
 * existiam — porque, para aquele tenant, não existiam mesmo.
 */
export async function constitutionVersion(): Promise<string> {
  const bundle = await loadBundle(BUNDLE_ROOT);
  const payload = bundle
    .map((concept) => `${concept.id}\u0000${JSON.stringify(concept.frontmatter)}\u0000${concept.body}`)
    .join("\u0001");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/** Avisos de conformidade do bundle em disco (link quebrado, por exemplo). */
export async function checkConstitution() {
  const bundle = await loadBundle(BUNDLE_ROOT);
  return { concepts: bundle.length, issues: validateBundle(bundle) };
}

export { sql };
