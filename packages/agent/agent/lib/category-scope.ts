import type { Database } from "@clara-financas/db";
import { concepts } from "@clara-financas/db/schema/knowledge";
import { categorySlug } from "@clara-financas/ledger";
import { and, eq } from "drizzle-orm";

import { refused, type ToolError } from "./errors";

/** A transação aberta por `forTenant`, tipada como o próprio tenant-scope faz. */
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * As categorias que existem para esta pessoa.
 *
 * Vem dos DOIS bundles: a constituição semeia a taxonomia inicial e o que a
 * pessoa aprovou depois vale igual. Restringir à constituição tornaria inútil
 * criar categoria nova pela conversa — ela nunca poderia ser usada.
 */
export async function loadValidCategories(tx: Tx, tenantId: string): Promise<Set<string>> {
  const known = await tx
    .select({ conceptId: concepts.conceptId })
    .from(concepts)
    .where(and(eq(concepts.tenantId, tenantId), eq(concepts.type, "Category")));

  return new Set(known.map((row) => categorySlug(row.conceptId)));
}

/**
 * Recusa uma categoria que não existe — dizendo como criá-la.
 *
 * A recusa antiga listava as válidas e parava aí, e o efeito era a Clara
 * empurrando o lançamento para a categoria menos errada da lista. Mas o
 * produto já decide o contrário em dois lugares: "entre uma categoria errada e
 * nenhuma, deixe nenhuma", e "categorias pertencem à pessoa" — `save_concept`
 * aceita `Category` justamente para a taxonomia crescer. Faltava a recusa
 * apontar para essa porta.
 */
export function unknownCategory(invalid: string[], valid: Set<string>): ToolError & {
  invalid: string[];
  validCategories: string[];
} {
  const suggestion = invalid[0];
  return {
    ...refused(
      "categoria_desconhecida",
      `Não existe categoria ${invalid.map((name) => `"${name}"`).join(", ")} para esta pessoa.`,
      {
        hint:
          suggestion === undefined
            ? "Use uma das categorias válidas."
            : `Ou use uma das válidas, ou proponha a criação com save_concept (type "Category", conceptId "categories/${suggestion}") e recategorize depois de aprovada. Entre uma categoria errada e nenhuma, deixe nenhuma.`,
      },
    ),
    invalid,
    validCategories: [...valid].sort(),
  };
}
