/**
 * Identidade da operadora, na leitura.
 *
 * `documents.issuer` é texto livre — quem escreve é a pessoa ou o extrator, e
 * "Nubank", "NuBank" e "nu bank" são a mesma operadora com três grafias. Esta
 * chave é o que agrupa as três na visão por operadora da web e no filtro por
 * operadora das ferramentas do analista. Morava em `apps/web/lib/issuers.ts`;
 * subiu para cá quando o agente ganhou o mesmo filtro, pelo mesmo motivo que
 * o predicado da fila de revisão subiu para `@clara-financas/db`: dois
 * consumidores com cópias divergentes é como tela e conversa começam a
 * discordar sobre o que é a mesma operadora.
 */

/** Operadora não identificada: o documento não dizia quem emitiu. */
export const UNKNOWN_ISSUER = "sem-operadora";

/** Chave estável derivada do nome da operadora: sem acento, sem caixa. */
export function issuerKey(issuer: string | null): string {
  if (issuer === null) return UNKNOWN_ISSUER;
  const slug = issuer
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  // Uma operadora escrita só com caracteres que o slug descarta não pode
  // colidir com "sem operadora" — isso a faria desaparecer no filtro.
  return slug === "" || slug === UNKNOWN_ISSUER ? `operadora-${hash(issuer)}` : slug;
}

function hash(value: string): string {
  let acc = 0;
  for (const char of value) acc = (acc * 31 + char.codePointAt(0)!) % 0xffffff;
  return acc.toString(36);
}
