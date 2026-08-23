import "server-only";

import { env } from "@clara-financas/env/server";
import { SignJWT } from "jose";

/**
 * O mesmo JWT que `/api/token` emite para o navegador, mas para uso
 * SERVIDOR→SERVIDOR — Server Components que leem `/api/ledger/*` direto do
 * serviço Python durante a renderização, sem round-trip pelo próprio Next.
 *
 * Vida curta (mesmo TTL do token do navegador): nasce e morre dentro da
 * requisição que o pediu.
 */
export const TOKEN_TTL_SECONDS = 10 * 60;

export async function mintAgentToken(tenantId: string, userId: string): Promise<string> {
  const secret = new TextEncoder().encode(env.AGENT_TOKEN_SECRET);
  return new SignJWT({ tenantId, userId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(env.APP_ORIGIN)
    .setAudience("clara-agent")
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}
