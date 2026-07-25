import { getDb } from "@clara-financas/db";
import { concepts } from "@clara-financas/db/schema/knowledge";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { merchantKey } from "@clara-financas/ledger";
import { and, eq } from "drizzle-orm";

/**
 * Apelidos de comerciante já aprovados pela pessoa.
 *
 * Fecha o mesmo ciclo que `apply_learned_rules` fecha para categorização: um
 * conceito que só pode ser gravado, e que nenhuma análise lê, não é
 * aprendizado — é anotação. `MerchantAlias` existe porque a normalização
 * determinística se recusa a adivinhar que "Anthropic* Claude Sub" e
 * "Claude.Ai Subscription" são a mesma empresa; a pessoa é quem sabe, e ao
 * aprovar ela ensina.
 *
 * O frontmatter carrega `aliases` com as grafias como aparecem na fatura. Elas
 * passam pelo MESMO normalizador que o razão usou ao gravar — sem isso o
 * apelido escrito com maiúscula, acento ou máscara do cartão nunca casaria com
 * a chave persistida, e o aprendizado seria silenciosamente inerte.
 */
export async function loadMerchantAliases(tenantId: string): Promise<string[][]> {
  const rows = await forTenant(
    tenantId,
    (tx) =>
      tx
        .select({ frontmatter: concepts.frontmatter })
        .from(concepts)
        .where(and(eq(concepts.bundle, "learnings"), eq(concepts.type, "MerchantAlias"))),
    getDb(),
  );

  const groups: string[][] = [];

  for (const row of rows) {
    const raw = row.frontmatter.aliases;
    if (!Array.isArray(raw)) continue;

    const keys = raw
      .filter((value): value is string => typeof value === "string" && value.trim() !== "")
      .map((value) => merchantKey({ originalDescription: value, merchant: value }))
      .filter((key): key is string => key !== null);

    // Um grupo de um só não funde nada; guardá-lo seria ruído.
    if (new Set(keys).size >= 2) groups.push([...new Set(keys)]);
  }

  return groups;
}
