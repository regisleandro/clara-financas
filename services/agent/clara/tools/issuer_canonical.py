"""A identidade da operadora, na ESCRITA — porta de `agent/lib/issuer-canonical.ts`.

Antes de gravar, se já existe um documento cuja chave é a mesma, a grafia
EXISTENTE vence. Primeira grafia é canônica; as seguintes convergem.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Document
from clara.ledger.issuer import issuer_key


def canonical_issuer(session: Session, tenant_id: str, issuer: str) -> str:
    wanted = issuer_key(issuer)
    rows = session.execute(
        select(Document.issuer.distinct()).where(
            Document.tenant_id == tenant_id, Document.issuer.is_not(None)
        )
    ).scalars().all()

    for existing in rows:
        if existing is not None and issuer_key(existing) == wanted:
            return existing
    return issuer
