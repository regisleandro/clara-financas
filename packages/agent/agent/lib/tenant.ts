import type { SessionContext } from "eve/context";

/**
 * Identidade desta instância do agente.
 *
 * No modelo silo cada deployment atende UM tenant, e o valor vem do env do
 * projeto. Nas Etapas 0–3 (modo pool) há uma instância só, e o valor fica
 * indefinido — o guard então aceita o tenant que vier do token verificado.
 */
export function instanceTenantId(): string | undefined {
  const value = process.env.TENANT_ID;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export type TenantCaller = { tenantId: string; userId: string };

/**
 * Guard obrigatório na entrada de TODA tool.
 *
 * O tenantId nunca vem do input da tool — vem da sessão autenticada. Um
 * `tenantId` em `inputSchema` seria bug de segurança, não parâmetro.
 *
 * O `typeof === "string"` não é zelo excessivo: `attributes` é
 * `Record<string, unknown>` e os próprios exemplos da doc do eve passam arrays.
 */
export function requireTenantCaller(ctx: SessionContext): TenantCaller {
  const caller = ctx.session.auth.current;
  const tenantId = caller?.attributes?.tenantId;

  if (caller?.principalType !== "user" || typeof tenantId !== "string") {
    throw new Error("An authenticated tenant user is required.");
  }

  // Silo: a instância recusa qualquer tenant que não seja o dela, mesmo que o
  // token esteja corretamente assinado.
  const instance = instanceTenantId();
  if (instance !== undefined && tenantId !== instance) {
    throw new Error("Cross-tenant call rejected.");
  }

  return { tenantId, userId: caller.principalId };
}

/** Extrai o tenantId de um principal, tolerando ausência e tipo inesperado. */
export function tenantIdOf(
  principal: SessionContext["session"]["auth"]["current"],
): string | undefined {
  const value = principal?.attributes?.tenantId;
  return typeof value === "string" ? value : undefined;
}
