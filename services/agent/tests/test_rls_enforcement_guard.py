"""O próprio guard de `for_tenant()`: conectar como superusuário deve ser recusado.

Duas garantias distintas, e o teste cobre as duas:

  - `clara_owner` (dono do schema) NÃO é superusuário nem tem BYPASSRLS — é
    assim que `scripts/dev-db.sh` o cria — então o guard não dispara para ele;
    quem o protege de vazar entre tenants é `FORCE ROW LEVEL SECURITY` nas
    tabelas, testado abaixo.
  - Conectar como `postgres` (superusuário de verdade) É o caso que o guard
    existe para pegar: sem ele, um erro de configuração apontando
    DATABASE_URL para o superusuário passaria despercebido, e a RLS viraria
    enfeite.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from clara import settings as settings_module
from clara.db import session as session_module
from clara.db import tenant_scope


def _reset_module_state() -> None:
    settings_module._settings = None
    session_module.get_engine.cache_clear()
    session_module._SessionLocal = None
    tenant_scope._rls_checked = False


@pytest.fixture(autouse=True)
def _isolate_module_caches() -> None:
    _reset_module_state()
    yield
    _reset_module_state()


def test_connecting_as_real_superuser_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://postgres:postgres_dev@127.0.0.1:5432/clara")
    monkeypatch.delenv("ALLOW_RLS_BYPASS", raising=False)

    with pytest.raises(RuntimeError, match="BYPASSRLS"):
        with tenant_scope.for_tenant("tenant_whatever"):
            pass


def test_allow_rls_bypass_env_opts_out_of_the_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://postgres:postgres_dev@127.0.0.1:5432/clara")
    monkeypatch.setenv("ALLOW_RLS_BYPASS", "1")

    # Não levanta — é o escape hatch documentado para reset/seed.
    with tenant_scope.for_tenant("tenant_whatever"):
        pass


def test_schema_owner_is_not_superuser_but_force_rls_still_isolates_it(
    monkeypatch: pytest.MonkeyPatch, tenant_id: str, other_tenant_id: str
) -> None:
    """`clara_owner` passa pelo guard (não é super/bypassrls) — e ainda assim
    não vê o dado de outro tenant, porque `FORCE ROW LEVEL SECURITY` vale
    inclusive para o dono da tabela."""
    monkeypatch.setenv(
        "DATABASE_URL", "postgresql+psycopg://clara_owner:clara_owner_dev@127.0.0.1:5432/clara"
    )

    doc_a = f"doc_{uuid.uuid4().hex}"
    with tenant_scope.for_tenant(tenant_id) as session:
        session.execute(
            text(
                "insert into documents (id, tenant_id, kind, blob_key, filename, content_hash) "
                "values (:id, :tid, 'credit_card_invoice', 'k', 'f.pdf', :hash)"
            ),
            {"id": doc_a, "tid": tenant_id, "hash": uuid.uuid4().hex},
        )

    with tenant_scope.for_tenant(other_tenant_id) as session:
        rows = session.execute(text("select id from documents")).scalars().all()
        assert doc_a not in rows
