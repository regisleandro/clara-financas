"""A mesma checagem de `clara/tools/tenant.py`, para rotas HTTP simples.

`JWTMiddleware` (`os_app.py`) já verificou a assinatura e a audiência antes
de qualquer rota rodar; aqui só resta ler as claims que ele guardou em
`request.state` — nunca aceitar tenant vindo de query string ou corpo (FR-001).
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request

from clara.tools.tenant import CrossTenantCallError, UnauthenticatedTenantError, instance_tenant_id


@dataclass(frozen=True)
class ApiCaller:
    tenant_id: str
    user_id: str


def require_api_caller(request: Request) -> ApiCaller:
    dependencies = getattr(request.state, "dependencies", None) or {}
    tenant_id = dependencies.get("tenantId")
    user_id = getattr(request.state, "user_id", None)

    valid_tenant = isinstance(tenant_id, str) and tenant_id != ""
    valid_user = isinstance(user_id, str) and user_id != ""
    if not valid_tenant or not valid_user:
        raise UnauthenticatedTenantError("An authenticated tenant user is required.")
    assert isinstance(tenant_id, str) and isinstance(user_id, str)

    instance = instance_tenant_id()
    if instance is not None and tenant_id != instance:
        raise CrossTenantCallError("Cross-tenant call rejected.")

    return ApiCaller(tenant_id=tenant_id, user_id=user_id)
