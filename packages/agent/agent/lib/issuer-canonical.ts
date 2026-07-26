import type { Database } from "@clara-financas/db";
import { documents } from "@clara-financas/db/schema/ledger";
import { issuerKey } from "@clara-financas/ledger";
import { and, eq, isNotNull } from "drizzle-orm";

/**
 * A identidade da operadora, agora também na ESCRITA.
 *
 * `documents.issuer` é texto livre, e a chave (`issuerKey`) só igualava na
 * leitura: "Nubank" e "NUBANK" produziam duas grafias gravadas, que a matriz
 * por operadora colapsava mas toda comparação literal não. O comerciante já
 * tinha essa disciplina (`merchantKey` derivado na fronteira); a operadora
 * ganha a dela aqui — antes de gravar, se já existe um documento cuja chave é
 * a mesma, a grafia EXISTENTE vence. Primeira grafia é canônica; as seguintes
 * convergem.
 *
 * O que isto não resolve: "Nu Bank" e "Nubank" têm chaves diferentes
 * (espaçamento é identidade, decisão registrada em
 * `packages/ledger/src/issuer.test.ts`). Unificar grafias estruturalmente
 * diferentes continua sendo trabalho de alias (`IssuerPattern`), não de chave.
 */
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function canonicalIssuer(
  tx: Tx,
  tenantId: string,
  issuer: string,
): Promise<string> {
  const wanted = issuerKey(issuer);

  const rows = await tx
    .selectDistinct({ issuer: documents.issuer })
    .from(documents)
    .where(and(eq(documents.tenantId, tenantId), isNotNull(documents.issuer)));

  for (const row of rows) {
    if (row.issuer !== null && issuerKey(row.issuer) === wanted) return row.issuer;
  }
  return issuer;
}
