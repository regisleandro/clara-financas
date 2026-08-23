"""Camadas 4 e 5 da defesa em profundidade — porta de `packages/db/src/tenant-scope.ts`.

Todo acesso a dado de tenant passa por `for_tenant()`. A função abre uma
transação e define `app.tenant_id` como variável LOCAL da transação — é esse
valor que as políticas RLS leem. Duas consequências que importam:

 1. O escopo faz parte da QUERY, não é filtro aplicado depois. Mesmo um
    `select` sem `where` só enxerga as linhas do tenant corrente.
 2. `set_config(..., true)` é local à transação, então uma conexão reusada do
    pool nunca vaza o tenant da requisição anterior.

Nenhuma tool monta SQL por conta própria; todas entram por aqui.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator
from contextlib import contextmanager

from sqlalchemy import text
from sqlalchemy.orm import Session

from clara.db.session import get_sessionmaker

_rls_checked = False


def _ensure_rls_enforced(session: Session) -> None:
    """A RLS só protege se o papel conectado estiver sujeito a ela.

    Conectar como superuser (ou papel com BYPASSRLS) não dá erro nenhum — as
    políticas viram enfeite e toda consulta "escopada" enxerga todos os
    tenants. `ALLOW_RLS_BYPASS=1` existe para scripts de manutenção
    conscientes (reset, seed); nunca para servir requisição de usuário.
    """
    global _rls_checked
    if os.environ.get("ALLOW_RLS_BYPASS") == "1":
        return
    if _rls_checked:
        return

    row = session.execute(
        text(
            "select rolsuper as rolsuper, rolbypassrls as rolbypassrls "
            "from pg_roles where rolname = current_user"
        )
    ).mappings().first()
    if row is not None and (row["rolsuper"] or row["rolbypassrls"]):
        raise RuntimeError(
            "DATABASE_URL conecta como superuser ou papel com BYPASSRLS: a RLS "
            "estaria desligada e todo dado de tenant ficaria global. Use o papel "
            "de aplicação (clara_app), ou ALLOW_RLS_BYPASS=1 para scripts de manutenção."
        )
    _rls_checked = True


@contextmanager
def for_tenant(tenant_id: str) -> Iterator[Session]:
    """Abre uma transação escopada ao tenant. Uso: `with for_tenant(tid) as session: ...`."""
    if not tenant_id:
        raise ValueError("for_tenant requires a non-empty tenant_id.")

    session = get_sessionmaker()()
    try:
        _ensure_rls_enforced(session)
        session.execute(text("select set_config('app.tenant_id', :tid, true)"), {"tid": tenant_id})
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def run_for_tenant[T](tenant_id: str, fn: Callable[[Session], T]) -> T:
    """Forma de função para chamadas de uma linha só, equivalente ao `forTenant(id, fn)` do TS."""
    with for_tenant(tenant_id) as session:
        return fn(session)


@contextmanager
def as_owner() -> Iterator[Session]:
    """Executa como dono do schema, IGNORANDO a RLS. Só para migração e manutenção."""
    session = get_sessionmaker()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
