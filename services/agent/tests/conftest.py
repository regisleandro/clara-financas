"""Fixtures compartilhadas.

Conecta como `clara_app` — nunca como dono do schema — porque é isso que os
testes de fundação (isolamento, imutabilidade) precisam exercitar: se
conectássemos como superusuário, a RLS estaria desligada e os testes passariam
por um motivo errado. Espelha o papel que `scripts/dev-db.sh`/`ci-db.sh` criam.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://clara_app:clara_app_dev@127.0.0.1:5432/clara")
os.environ.setdefault("AGENT_TOKEN_SECRET", "dev-secret-for-tests-only")
os.environ.setdefault("APP_ORIGIN", "http://localhost:3000")

from clara.db.session import get_sessionmaker  # noqa: E402


@pytest.fixture()
def raw_session() -> Iterator[Session]:
    """Sessão sem escopo de tenant — só para inserir os fixtures de apoio (user/tenant)."""
    session = get_sessionmaker()()
    try:
        yield session
        session.commit()
    finally:
        session.close()


@pytest.fixture()
def tenant_id(raw_session: Session) -> str:
    """Cria um usuário e um tenant reais, exigidos pelas FKs de `tenants`."""
    user_id = f"user_{uuid.uuid4().hex}"
    tid = f"tenant_{uuid.uuid4().hex}"
    raw_session.execute(
        text(
            'insert into "user" (id, name, email, email_verified) '
            "values (:id, :name, :email, false)"
        ),
        {"id": user_id, "name": "Fixture", "email": f"{user_id}@example.com"},
    )
    raw_session.execute(
        text(
            "insert into tenants (id, owner_user_id, slug, status) "
            "values (:id, :owner, :slug, 'ready')"
        ),
        {"id": tid, "owner": user_id, "slug": tid},
    )
    return tid


@pytest.fixture()
def other_tenant_id(raw_session: Session) -> str:
    user_id = f"user_{uuid.uuid4().hex}"
    tid = f"tenant_{uuid.uuid4().hex}"
    raw_session.execute(
        text(
            'insert into "user" (id, name, email, email_verified) '
            "values (:id, :name, :email, false)"
        ),
        {"id": user_id, "name": "Other", "email": f"{user_id}@example.com"},
    )
    raw_session.execute(
        text(
            "insert into tenants (id, owner_user_id, slug, status) "
            "values (:id, :owner, :slug, 'ready')"
        ),
        {"id": tid, "owner": user_id, "slug": tid},
    )
    return tid
