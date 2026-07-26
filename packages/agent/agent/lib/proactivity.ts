import type { Database } from "@clara-financas/db";
import { concepts } from "@clara-financas/db/schema/knowledge";
import { and, eq } from "drizzle-orm";

/**
 * O consentimento de proatividade — onde ele mora e como se lê.
 *
 * O princípio do produto diz "proatividade depende de relevância E
 * consentimento", e só a metade relevância existia: a varredura diária corria
 * para todo tenant `ready`, sem nenhuma porta para desligar os avisos como um
 * todo. (Cada compromisso individual sempre passou por aprovação — o que
 * faltava era o interruptor geral.)
 *
 * O estado vive num CONCEITO do bundle `learnings` — dado do próprio tenant,
 * atrás da RLS, com trilha de revisões — e não numa coluna do registry de
 * tenants: o registry é o mapa do control plane, e uma preferência da pessoa
 * é conteúdo, não mapa. Ausência de conceito = ligado, porque tudo que já
 * dispara aviso hoje foi individualmente aprovado num cartão.
 */
export const PROACTIVITY_CONCEPT_ID = "preferences/proactivity";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Lê o consentimento dentro de um escopo `forTenant` já aberto. */
export async function proactivityEnabled(tx: Tx, tenantId: string): Promise<boolean> {
  const [row] = await tx
    .select({ frontmatter: concepts.frontmatter })
    .from(concepts)
    .where(
      and(
        eq(concepts.tenantId, tenantId),
        eq(concepts.bundle, "learnings"),
        eq(concepts.conceptId, PROACTIVITY_CONCEPT_ID),
      ),
    )
    .limit(1);

  return row?.frontmatter?.enabled !== false;
}
