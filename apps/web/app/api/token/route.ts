import { env } from "@clara-financas/env/server";
import { SignJWT } from "jose";

import { getTenantContext } from "@/lib/tenant";

/**
 * Emite o token de acesso do navegador à instância do agente.
 *
 * Camada 1 da defesa em profundidade. O claim `tenantId` NÃO vem do cliente:
 * é derivado da sessão autenticada. Do outro lado, a instância confere esse
 * claim contra o próprio TENANT_ID de ambiente — é isso que faz um token
 * válido do tenant B ser recusado pela instância do A, sem consultar tabela
 * nem depender de acerto de roteamento.
 *
 * Vida curta de propósito: o token viaja no navegador e não deve sobreviver
 * a uma troca de contexto.
 */
const TOKEN_TTL_SECONDS = 10 * 60;

export async function POST() {
  const context = await getTenantContext();

  if (!context) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  if (context.status !== "ready") {
    return Response.json({ error: "tenant_not_ready", status: context.status }, { status: 409 });
  }

  const secret = new TextEncoder().encode(env.AGENT_TOKEN_SECRET);

  const token = await new SignJWT({
    tenantId: context.tenantId,
    userId: context.userId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(context.userId)
    .setIssuer(env.APP_ORIGIN)
    .setAudience("clara-agent")
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secret);

  return Response.json({
    token,
    expiresIn: TOKEN_TTL_SECONDS,
    agentHost: context.agentHost,
  });
}
