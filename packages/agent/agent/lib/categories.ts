import { getDb } from "@clara-financas/db";
import { concepts } from "@clara-financas/db/schema/knowledge";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq } from "drizzle-orm";

/**
 * Traduz identificador de categoria para o nome que a pessoa lê.
 *
 * O identificador é inglês por decisão de projeto (código em inglês, interface
 * em português) — `groceries`, `dining`. O nome em português já existe no
 * `title` do conceito da constituição: "Mercado", "Restaurantes".
 *
 * O que faltava era alguém ligar os dois. Sem isso a Clara dizia "dining" na
 * conversa e a tela mostrava "dining", num produto inteiramente em português —
 * o identificador vazando para o usuário final.
 *
 * Resolver AQUI, e não no frontend, conserta os dois de uma vez: o modelo
 * recebe o rótulo junto com o número, então escreve "Restaurantes" na prosa
 * também. Traduzir só na tela deixaria a fala errada.
 */
export type CategoryLabels = Readonly<Record<string, string>>;

export async function loadCategoryLabels(tenantId: string): Promise<CategoryLabels> {
  const rows = await forTenant(
    tenantId,
    (tx) =>
      tx
        .select({ conceptId: concepts.conceptId, frontmatter: concepts.frontmatter })
        .from(concepts)
        .where(and(eq(concepts.tenantId, tenantId), eq(concepts.type, "Category"))),
    getDb(),
  );

  const labels: Record<string, string> = {};
  for (const row of rows) {
    // O id do conceito é o caminho no bundle (`categories/groceries`), mas o
    // razão guarda só o slug. Aceitar as duas formas evita que a origem do
    // dado decida se a tradução funciona.
    const slug = row.conceptId.replace(/^categories\//, "");
    const title = row.frontmatter.title;
    if (typeof title === "string" && title !== "") labels[slug] = title;
  }
  return labels;
}

/**
 * Aplica o rótulo, com queda para o próprio identificador.
 *
 * Categoria sem conceito correspondente é possível — uma regra aprendida pode
 * apontar para uma categoria que foi removida depois. Mostrar o identificador
 * cru é feio, mas é honesto e não esconde a inconsistência; inventar um nome
 * bonito esconderia.
 */
export function categoryLabel(labels: CategoryLabels, category: string | null): string {
  if (category === null) return "Sem categoria";
  return labels[category] ?? category;
}
