"""`build_overview` contra Postgres real — porta de `overview-model.test.ts`."""

from __future__ import annotations

import uuid

from clara.db.models import Batch, Document, Transaction
from clara.db.tenant_scope import for_tenant
from clara.tools.overview import ALL_ISSUERS, build_overview


def _seed(
    session,
    tenant: str,
    *,
    date: str,
    amount: int,
    category: str | None = None,
    issuer: str | None = "Nubank",
    kind: str = "purchase",
) -> str:  # noqa: ANN001
    doc_id = f"doc_{uuid.uuid4().hex}"
    batch_id = f"batch_{uuid.uuid4().hex}"
    txn_id = f"txn_{uuid.uuid4().hex}"
    session.add(
        Document(
            id=doc_id,
            tenant_id=tenant,
            kind="credit_card_invoice",
            blob_key="k",
            filename="f.pdf",
            content_hash=uuid.uuid4().hex,
            issuer=issuer,
        )
    )
    session.flush()
    session.add(Batch(id=batch_id, tenant_id=tenant, document_id=doc_id, status="confirmed"))
    session.flush()
    session.add(
        Transaction(
            id=txn_id,
            tenant_id=tenant,
            batch_id=batch_id,
            status="confirmed",
            date=date,
            original_description="Loja",
            amount=amount,
            kind=kind,
            category=category,
            extraction_confidence="alta",
            source_document_id=doc_id,
        )
    )
    session.flush()
    return txn_id


def test_empty_ledger_has_no_selected_month(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        overview = build_overview(session, tenant_id)

    assert overview.selected_month is None
    assert overview.months == []
    assert overview.total == 0


def test_defaults_to_most_recent_month(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-05-01", amount=1000, category="groceries")
        _seed(session, tenant_id, date="2026-06-01", amount=2000, category="groceries")

    with for_tenant(tenant_id) as session:
        overview = build_overview(session, tenant_id)

    assert overview.selected_month == "2026-06"
    assert overview.total == 2000
    assert overview.months == ["2026-06", "2026-05"]


def test_comparison_is_none_without_previous_month_data(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-01", amount=2000)

    with for_tenant(tenant_id) as session:
        overview = build_overview(session, tenant_id, month="2026-06")

    assert overview.comparison is None


def test_comparison_computed_against_previous_month(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-05-01", amount=1000)
        _seed(session, tenant_id, date="2026-06-01", amount=1500)

    with for_tenant(tenant_id) as session:
        overview = build_overview(session, tenant_id, month="2026-06")

    assert overview.comparison is not None
    assert overview.comparison.previous_month == "2026-05"
    assert overview.comparison.previous_total == 1000
    assert overview.comparison.delta == 500
    assert overview.comparison.delta_percent == 50.0


def test_issuer_filter_scopes_totals_and_selection(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-01", amount=1000, issuer="Nubank")
        _seed(session, tenant_id, date="2026-06-02", amount=5000, issuer="Itaú")

    with for_tenant(tenant_id) as session:
        overview = build_overview(session, tenant_id, month="2026-06", issuer="itau")

    assert overview.selected_issuer == "itau"
    assert overview.total == 5000
    assert {i.key for i in overview.issuers} == {"nubank", "itau"}


def test_unknown_issuer_falls_back_to_all(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-01", amount=1000)

    with for_tenant(tenant_id) as session:
        overview = build_overview(session, tenant_id, month="2026-06", issuer="banco-inexistente")

    assert overview.selected_issuer == ALL_ISSUERS
    assert overview.total == 1000


def test_categories_only_include_positive_gross(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-01", amount=1000, category="groceries")
        _seed(session, tenant_id, date="2026-06-02", amount=-200, category="entertainment")

    with for_tenant(tenant_id) as session:
        overview = build_overview(session, tenant_id, month="2026-06")

    assert {c.category for c in overview.categories} == {"groceries"}


def test_insight_only_fires_when_one_category_explains_a_quarter_of_the_increase(
    tenant_id: str,
) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-05-01", amount=1000, category="food")
        _seed(session, tenant_id, date="2026-06-01", amount=9000, category="food")

    with for_tenant(tenant_id) as session:
        overview = build_overview(session, tenant_id, month="2026-06")

    assert overview.insight is not None
    assert overview.insight.category == "food"
    assert overview.insight.delta_ratio == 8.0
