"""A conexão com o banco.

Espelha `packages/db/src/index.ts`: `create_engine` é um singleton preguiçoso —
conectar no escopo do módulo obrigaria DATABASE_URL a existir em tempo de
import, antes de qualquer request. `for_tenant()` (tenant_scope.py) é o único
caminho de acesso a dado de tenant; nada aqui monta SQL por conta própria.
"""

from __future__ import annotations

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from clara.settings import get_settings


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    settings = get_settings()
    # pool pequeno: cada instância do serviço abre poucas conexões, com um
    # pooler (pgbouncer/Supavisor) à frente em produção — igual ao `max: 1`
    # do lado TypeScript.
    return create_engine(settings.database_url, pool_size=5, max_overflow=5, pool_pre_ping=True)


_SessionLocal: sessionmaker[Session] | None = None


def get_sessionmaker() -> sessionmaker[Session]:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine(), expire_on_commit=False)
    return _SessionLocal


def new_session() -> Iterator[Session]:
    """Uma sessão nova, sem escopo de tenant. Use `for_tenant()` para dados de tenant."""
    session = get_sessionmaker()()
    try:
        yield session
    finally:
        session.close()
