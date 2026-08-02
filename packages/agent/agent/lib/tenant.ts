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
 * O mínimo que o guard precisa enxergar.
 *
 * Declarado estruturalmente porque ele roda em dois lugares com contextos
 * diferentes: nas tools (`SessionContext`) e nos resolvedores de instruções
 * dinâmicas (`DynamicResolveContext`, que não tem sandbox nem skills). Ambos
 * carregam a sessão autenticada, que é a única coisa lida aqui — exigir o
 * contexto completo obrigaria a duplicar o guard, e guard duplicado é guard
 * que uma hora diverge.
 */
export type AuthenticatedContext = {
  session: {
    id?: string;
    auth: SessionContext["session"]["auth"];
    parent?: { sessionId?: string };
  };
};

/**
 * Guard obrigatório na entrada de TODA tool.
 *
 * O tenantId nunca vem do input da tool — vem da sessão autenticada. Um
 * `tenantId` em `inputSchema` seria bug de segurança, não parâmetro.
 *
 * O `typeof === "string"` não é zelo excessivo: `attributes` é
 * `Record<string, unknown>` e os próprios exemplos da doc do eve passam arrays.
 */
export function requireTenantCaller(ctx: AuthenticatedContext): TenantCaller {
  // Declared subagents can inherit the authenticated user as the session
  // initiator while `auth.current` is reserved for the currently executing
  // identity. Treat both as the same caller for tenant-scoped operations,
  // preserving the fail-closed checks below when neither is a user.
  const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
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

export type SessionCaller = TenantCaller & { sessionId: string };

/** Uma referência conversacional só é segura quando pertence a uma sessão. */
export function requireSessionCaller(ctx: AuthenticatedContext): SessionCaller {
  const caller = requireTenantCaller(ctx);
  const sessionId = ctx.session.id;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("An Eve session id is required.");
  }
  return { ...caller, sessionId };
}

/** Extrai o tenantId de um principal, tolerando ausência e tipo inesperado. */
export function tenantIdOf(
  principal: SessionContext["session"]["auth"]["current"],
): string | undefined {
  const value = principal?.attributes?.tenantId;
  return typeof value === "string" ? value : undefined;
}
