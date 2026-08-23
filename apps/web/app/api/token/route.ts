import { mintAgentToken, TOKEN_TTL_SECONDS } from "@/lib/agent-token";
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
export async function POST() {
  const context = await getTenantContext();

  if (!context) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  if (context.status !== "ready") {
    return Response.json({ error: "tenant_not_ready", status: context.status }, { status: 409 });
  }

  const token = await mintAgentToken(context.tenantId, context.userId);

  return Response.json({
    token,
    expiresIn: TOKEN_TTL_SECONDS,
    agentHost: context.agentHost,
  });
}
