"""As seis ferramentas do analista contra Postgres real — cada painel
devolvido precisa passar por `require_provenance` sem levantar."""

from __future__ import annotations

import uuid

from clara.db.models import Batch, Document, Transaction
from clara.db.tenant_scope import for_tenant
from clara.tools.aggregate_by_category import aggregate_by_category
from clara.tools.aggregate_by_month import aggregate_by_month
from clara.tools.analysis_scope import AllScope, CalendarMonthScope
from clara.tools.analyze_series import SeriesPeriodInput, analyze_series
from clara.tools.compare_periods import compare_periods
from clara.tools.detect_recurrences import detect_recurrences
from clara.tools.query_ledger import query_ledger
from clara.views.panels import (
    BreakdownPanel,
    ComparisonPanel,
    MetricPanel,
    RecurrencesPanel,
    SeriesPanel,
    TransactionsPanel,
    require_provenance,
)


def _seed(
    session,
    tenant: str,
    *,
    date: str,
    amount: int,
    category: str | None = None,
    merchant: str | None = None,
    issuer: str = "Nubank",
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
            original_description=merchant or "Loja Generica",
            merchant=merchant,
            amount=amount,
            kind=kind,
            category=category,
            extraction_confidence="alta",
            source_document_id=doc_id,
        )
    )
    session.flush()
    return txn_id


def test_aggregate_by_category_builds_valid_breakdown(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-05", amount=5000, category="groceries")
        _seed(session, tenant_id, date="2026-06-10", amount=3000, category="restaurants")

    with for_tenant(tenant_id) as session:
        panel = aggregate_by_category(session, tenant_id, CalendarMonthScope(month="2026-06"))

    assert isinstance(panel, BreakdownPanel)
    require_provenance(panel)
    assert {r.label for r in panel.rows} == {"groceries", "restaurants"}
    assert panel.metric.amount == 8000


def test_aggregate_by_category_empty_scope_is_a_metric(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        panel = aggregate_by_category(session, tenant_id, CalendarMonthScope(month="2026-01"))

    assert isinstance(panel, MetricPanel)
    assert panel.metric.text == "Sem lançamentos"


def test_aggregate_by_month_builds_series(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-05-01", amount=1000)
        _seed(session, tenant_id, date="2026-06-01", amount=2000)

    with for_tenant(tenant_id) as session:
        series_panel, issuer_panel = aggregate_by_month(session, tenant_id)

    assert isinstance(series_panel, SeriesPanel)
    require_provenance(series_panel)
    assert series_panel.metric.amount == 3000
    assert issuer_panel is None  # uma operadora só


def test_aggregate_by_month_with_two_issuers_adds_breakdown(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-01", amount=1000, issuer="Nubank")
        _seed(session, tenant_id, date="2026-06-02", amount=2000, issuer="Itaú")

    with for_tenant(tenant_id) as session:
        _series, issuer_panel = aggregate_by_month(session, tenant_id)

    assert isinstance(issuer_panel, BreakdownPanel)
    require_provenance(issuer_panel)
    assert len(issuer_panel.rows) == 2


def test_compare_periods_returns_metric_when_a_side_is_empty(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-01", amount=1000)

    with for_tenant(tenant_id) as session:
        panel = compare_periods(
            session,
            tenant_id,
            current=CalendarMonthScope(month="2026-06"),
            previous=CalendarMonthScope(month="2026-01"),
        )

    assert isinstance(panel, MetricPanel)
    assert panel.metric.text == "Dados insuficientes"


def test_compare_periods_builds_comparison_with_both_sides(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-05-01", amount=1000, category="food")
        _seed(session, tenant_id, date="2026-06-01", amount=9000, category="food")

    with for_tenant(tenant_id) as session:
        panel = compare_periods(
            session,
            tenant_id,
            current=CalendarMonthScope(month="2026-06"),
            previous=CalendarMonthScope(month="2026-05"),
        )

    assert isinstance(panel, ComparisonPanel)
    require_provenance(panel)
    assert panel.metric.amount == 8000


def test_detect_recurrences_finds_confirmed_pattern(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-04-10", amount=5000, merchant="Netflix")
        _seed(session, tenant_id, date="2026-05-10", amount=5000, merchant="Netflix")
        _seed(session, tenant_id, date="2026-06-10", amount=5000, merchant="Netflix")

    with for_tenant(tenant_id) as session:
        panel = detect_recurrences(session, tenant_id)

    assert isinstance(panel, RecurrencesPanel)
    require_provenance(panel)
    assert panel.rows[0].label == "Netflix"


def test_detect_recurrences_no_pattern_is_a_metric(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-01", amount=1000, merchant="Loja Unica")

    with for_tenant(tenant_id) as session:
        panel = detect_recurrences(session, tenant_id)

    assert isinstance(panel, MetricPanel)


def test_analyze_series_two_periods(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-05-01", amount=1000, category="food")
        _seed(session, tenant_id, date="2026-06-01", amount=9000, category="food")

    with for_tenant(tenant_id) as session:
        result = analyze_series(
            session,
            tenant_id,
            [
                SeriesPeriodInput("mai", "Maio", CalendarMonthScope(month="2026-05")),
                SeriesPeriodInput("jun", "Junho", CalendarMonthScope(month="2026-06")),
            ],
        )

    assert isinstance(result, tuple)
    series_panel, drivers_panel = result
    require_provenance(series_panel)
    assert series_panel.metric.amount == 8000
    assert drivers_panel is not None
    require_provenance(drivers_panel)


def test_analyze_series_empty_period_is_a_metric(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-01", amount=1000)

    with for_tenant(tenant_id) as session:
        result = analyze_series(
            session,
            tenant_id,
            [
                SeriesPeriodInput("mai", "Maio", CalendarMonthScope(month="2026-05")),
                SeriesPeriodInput("jun", "Junho", CalendarMonthScope(month="2026-06")),
            ],
        )

    assert isinstance(result, MetricPanel)


def test_query_ledger_finds_by_search_term(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-01", amount=1000, merchant="Padaria Sao Jose")

    with for_tenant(tenant_id) as session:
        panel = query_ledger(session, tenant_id, search="padaria")

    assert isinstance(panel, TransactionsPanel)
    require_provenance(panel)


def test_query_ledger_no_match_is_a_metric(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        panel = query_ledger(session, tenant_id, scope=AllScope())

    assert isinstance(panel, MetricPanel)
