"""O guard de tenant — porta de `agent/lib/tenant.ts`, contra um RunContext real do Agno."""

from __future__ import annotations

import pytest
from agno.run.base import RunContext

from clara.tools.tenant import (
    CrossTenantCallError,
    UnauthenticatedTenantError,
    require_session_caller,
    require_tenant_caller,
)


def _run_context(**overrides: object) -> RunContext:
    defaults: dict[str, object] = {
        "run_id": "run_1",
        "session_id": "sess_1",
        "user_id": "user_1",
        "dependencies": {"tenantId": "tenant_a", "userId": "user_1"},
    }
    defaults.update(overrides)
    return RunContext(**defaults)  # type: ignore[arg-type]


def test_extracts_tenant_and_user_from_dependencies() -> None:
    caller = require_tenant_caller(_run_context())
    assert caller.tenant_id == "tenant_a"
    assert caller.user_id == "user_1"


def test_rejects_missing_tenant_claim() -> None:
    with pytest.raises(UnauthenticatedTenantError):
        require_tenant_caller(_run_context(dependencies={}))


def test_rejects_missing_user_id() -> None:
    with pytest.raises(UnauthenticatedTenantError):
        require_tenant_caller(_run_context(user_id=None))


def test_session_caller_requires_session_id() -> None:
    caller = require_session_caller(_run_context())
    assert caller.session_id == "sess_1"

    with pytest.raises(UnauthenticatedTenantError):
        require_session_caller(_run_context(session_id=""))


def test_silo_mode_rejects_cross_tenant_token(monkeypatch: pytest.MonkeyPatch) -> None:
    from clara import settings as settings_module

    monkeypatch.setenv("TENANT_ID", "tenant_a")
    settings_module._settings = None
    try:
        # mesmo tenant: passa
        require_tenant_caller(_run_context(dependencies={"tenantId": "tenant_a"}))
        # tenant diferente, mesmo com token assinado corretamente: recusa
        with pytest.raises(CrossTenantCallError):
            require_tenant_caller(_run_context(dependencies={"tenantId": "tenant_b"}))
    finally:
        monkeypatch.delenv("TENANT_ID", raising=False)
        settings_module._settings = None
