"""O predicado único de revisão, contra o banco de verdade — porta de
`packages/db/src/queries/review.ts`, exercitada como as tools vão exercitá-lo:
via SQLAlchemy Core, não SQL cru."""

from __future__ import annotations

import uuid
from datetime import UTC

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Batch, Document, Transaction
from clara.db.queries.review import (
    needs_review_condition,
    review_reasons_for,
    uncategorized_spend_condition,
)
from clara.db.tenant_scope import for_tenant


def _seed(session: Session, tenant: str, **overrides: object) -> str:
    doc_id = f"doc_{uuid.uuid4().hex}"
    batch_id = f"batch_{uuid.uuid4().hex}"
    txn_id = f"txn_{uuid.uuid4().hex}"
    session.add(Document(id=doc_id, tenant_id=tenant, kind="credit_card_invoice",
                          blob_key="k", filename="f.pdf", content_hash=uuid.uuid4().hex))
    session.flush()
    session.add(Batch(id=batch_id, tenant_id=tenant, document_id=doc_id))
    session.flush()
    defaults: dict[str, object] = dict(
        id=txn_id, tenant_id=tenant, batch_id=batch_id, status="confirmed",
        date="2026-01-05", original_description="Padaria", merchant="Padaria",
        amount=1500, kind="purchase", category="groceries",
        extraction_confidence="alta", source_document_id=doc_id,
    )
    defaults.update(overrides)
    session.add(Transaction(**defaults))  # type: ignore[arg-type]
    session.flush()
    return txn_id


def test_uncategorized_spend_excludes_payment_and_adjustment(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, category=None, kind="purchase")
        _seed(session, tenant_id, category=None, kind="payment")
        _seed(session, tenant_id, category=None, kind="adjustment")

        rows = session.execute(
            select(Transaction.id).where(uncategorized_spend_condition())
        ).scalars().all()
        assert len(rows) == 1


def test_needs_review_excludes_already_attested(tenant_id: str) -> None:
    from datetime import datetime

    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, category=None)
        attested_id = _seed(
            session, tenant_id, category=None,
            reviewed_at=datetime.now(UTC), reviewed_by="human:u1",
        )

        rows = session.execute(
            select(Transaction.id).where(needs_review_condition())
        ).scalars().all()
        assert attested_id not in rows
        assert len(rows) == 1


def test_review_reasons_mirrors_the_flags_condition() -> None:
    assert review_reasons_for(
        category=None, merchant=None, kind="purchase", extraction_confidence="baixa"
    ) == ["sem_categoria", "confianca_baixa", "sem_comerciante"]

    assert review_reasons_for(
        category="groceries", merchant="Padaria", kind="purchase", extraction_confidence="alta"
    ) == []

    # Pagamento não é categorizável: sem categoria não entra como motivo.
    assert review_reasons_for(
        category=None, merchant="Nubank", kind="payment", extraction_confidence="alta"
    ) == []
