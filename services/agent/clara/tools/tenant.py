"""Guard obrigatório na entrada de TODA tool — porta de `agent/lib/tenant.ts`.

O tenant nunca vem do input da tool: vem das `dependencies` do `RunContext`,
que o `JWTMiddleware` preenche a partir da claim verificada do token
(`dependencies_claims=["tenantId", "userId"]` em `os_app.py`). Um `tenant_id`
declarado no schema de uma tool seria bug de segurança, não parâmetro (FR-001).
"""

from __future__ import annotations

from dataclasses import dataclass

from agno.run.base import RunContext

from clara.settings import get_settings


def instance_tenant_id() -> str | None:
    """No modelo silo cada deployment atende UM tenant. Em modo pool, None —
    o guard então aceita o tenant que vier do token verificado."""
    value = get_settings().tenant_id
    return value if value else None


@dataclass(frozen=True)
class TenantCaller:
    tenant_id: str
    user_id: str


class UnauthenticatedTenantError(RuntimeError):
    pass


class CrossTenantCallError(RuntimeError):
    pass


def require_tenant_caller(run_context: RunContext) -> TenantCaller:
    dependencies = run_context.dependencies or {}
    tenant_id = dependencies.get("tenantId")
    user_id = run_context.user_id

    valid_tenant = isinstance(tenant_id, str) and tenant_id
    valid_user = isinstance(user_id, str) and user_id
    if not valid_tenant or not valid_user:
        raise UnauthenticatedTenantError("An authenticated tenant user is required.")

    # Silo: a instância recusa qualquer tenant que não seja o dela, mesmo com
    # um token corretamente assinado por outro tenant.
    instance = instance_tenant_id()
    if instance is not None and tenant_id != instance:
        raise CrossTenantCallError("Cross-tenant call rejected.")

    return TenantCaller(tenant_id=tenant_id, user_id=user_id)


@dataclass(frozen=True)
class SessionCaller(TenantCaller):
    session_id: str


def require_session_caller(run_context: RunContext) -> SessionCaller:
    """Uma referência conversacional só é segura quando pertence a uma sessão."""
    caller = require_tenant_caller(run_context)
    session_id = run_context.session_id
    if not session_id:
        raise UnauthenticatedTenantError("An agent session id is required.")
    return SessionCaller(tenant_id=caller.tenant_id, user_id=caller.user_id, session_id=session_id)
