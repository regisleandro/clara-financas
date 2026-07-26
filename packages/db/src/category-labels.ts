import { and, eq } from "drizzle-orm";

import { getDb, type Database } from "./index";
import { concepts } from "./schema/knowledge";
import { forTenant } from "./tenant-scope";

/**
 * Carrega o mapa slug → título em português das categorias do tenant.
 *
 * Vive aqui — e não no pacote do agente, onde nasceu — porque agente e web
 * precisam do mesmo mapa: sem isso o dashboard mostrava "dining" enquanto a
 * conversa dizia "Restaurantes". A aplicação do rótulo (`categoryLabel`) é
 * pura e mora em `@clara-financas/ledger`; o retorno daqui é estruturalmente
 * compatível com o `CategoryLabels` de lá.
 */
export async function loadCategoryLabels(
  tenantId: string,
  db: Database = getDb(),
): Promise<Readonly<Record<string, string>>> {
  const rows = await forTenant(
    tenantId,
    (tx) =>
      tx
        .select({ conceptId: concepts.conceptId, frontmatter: concepts.frontmatter })
        .from(concepts)
        .where(and(eq(concepts.tenantId, tenantId), eq(concepts.type, "Category"))),
    db,
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
