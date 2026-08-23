from __future__ import annotations

from clara.ledger.analysis import (
    aggregate_by_category,
    aggregate_by_issuer_month,
    compare_periods,
    detect_recurrences,
    total_spend,
)
from clara.ledger.types import LedgerEntry


def entry(
    id: str,
    *,
    date: str = "2026-06-01",
    amount: int = 1000,
    kind: str = "purchase",
    category: str | None = None,
    merchant: str | None = None,
    merchant_key: str | None = None,
    original_description: str = "loja x",
    status: str = "confirmed",
    source_document_id: str = "doc_1",
    issuer: str | None = None,
) -> LedgerEntry:
    return {
        "id": id,
        "date": date,
        "amount": amount,
        "kind": kind,  # type: ignore[typeddict-item]
        "category": category,
        "merchant": merchant,
        "merchant_key": merchant_key,
        "original_description": original_description,
        "extraction_confidence": "alta",
        "status": status,
        "source_document_id": source_document_id,
        "page": None,
        "issuer": issuer,
    }


def test_total_spend_excludes_payment() -> None:
    rows = [entry("t1", amount=5000), entry("t2", amount=30000, kind="payment")]
    result = total_spend(rows)
    assert result.value == 5000
    assert result.transaction_ids == ["t1"]


def test_aggregate_by_category_separates_gross_and_credits() -> None:
    rows = [
        entry("t1", amount=10000, category="groceries"),
        entry("t2", amount=-2000, category="groceries"),
        entry("t3", amount=5000, category="entertainment"),
    ]
    totals = aggregate_by_category(rows)
    groceries = next(t for t in totals if t.category == "groceries")
    assert groceries.value == 8000
    assert groceries.gross.value == 10000
    assert groceries.gross.transaction_ids == ["t1"]
    assert groceries.credits.value == -2000
    assert groceries.credits.transaction_ids == ["t2"]
    # share é fração das COMPRAS (bruto), não do líquido: 10000 / (10000+5000)
    assert groceries.share == 10000 / 15000


def test_aggregate_by_category_normalizes_concept_id_prefix() -> None:
    rows = [
        entry("t1", amount=1000, category="entertainment"),
        entry("t2", amount=1000, category="categories/entertainment"),
    ]
    totals = aggregate_by_category(rows)
    assert len(totals) == 1
    assert totals[0].value == 2000


def test_aggregate_by_category_keeps_none_as_its_own_bucket() -> None:
    rows = [entry("t1", amount=1000, category=None)]
    totals = aggregate_by_category(rows)
    assert totals[0].category is None
    assert totals[0].value == 1000


def test_compare_periods_share_of_change_only_counts_increases() -> None:
    current = [entry("t1", amount=90000, category="restaurants")]
    previous = [entry("t0", amount=10000, category="restaurants")]
    total_delta, categories = compare_periods(current, previous)
    assert total_delta == 80000
    restaurants = next(c for c in categories if c.category == "restaurants")
    assert restaurants.delta == 80000
    assert restaurants.share_of_change == 1.0


def test_aggregate_by_issuer_month_groups_by_purchase_month_not_closing() -> None:
    rows = [
        entry("t1", date="2026-05-31", amount=1000, issuer="Nubank"),
        entry("t2", date="2026-06-15", amount=2000, issuer="Nubank"),
    ]
    matrix = aggregate_by_issuer_month(rows)
    assert matrix.months == ["2026-06", "2026-05"]
    nubank = matrix.issuers[0]
    assert nubank.issuer == "Nubank"
    assert nubank.by_month[0] is not None and nubank.by_month[0].value == 2000
    assert nubank.by_month[1] is not None and nubank.by_month[1].value == 1000


def test_aggregate_by_issuer_month_merges_case_variants_of_same_issuer() -> None:
    rows = [
        entry("t1", date="2026-06-01", amount=1000, issuer="Nubank"),
        entry("t2", date="2026-06-02", amount=2000, issuer="NuBank"),
    ]
    matrix = aggregate_by_issuer_month(rows)
    assert len(matrix.issuers) == 1
    assert matrix.issuers[0].total.value == 3000


def test_aggregate_by_issuer_month_keeps_missing_issuer_as_row() -> None:
    rows = [entry("t1", amount=1000, issuer=None)]
    matrix = aggregate_by_issuer_month(rows)
    assert len(matrix.issuers) == 1
    assert matrix.issuers[0].issuer is None


def test_detect_recurrences_needs_regular_monthly_interval() -> None:
    rows = [
        entry("t1", date="2026-04-10", amount=5000, merchant="Netflix", merchant_key="netflix"),
        entry("t2", date="2026-05-10", amount=5000, merchant="Netflix", merchant_key="netflix"),
        entry("t3", date="2026-06-10", amount=5000, merchant="Netflix", merchant_key="netflix"),
    ]
    recurrences = detect_recurrences(rows)
    assert len(recurrences) == 1
    assert recurrences[0].merchant == "Netflix"
    assert recurrences[0].occurrences == 3
    assert recurrences[0].confirmed is True


def test_detect_recurrences_two_charges_are_unconfirmed() -> None:
    rows = [
        entry("t1", date="2026-05-10", amount=5000, merchant="Netflix", merchant_key="netflix"),
        entry("t2", date="2026-06-10", amount=5000, merchant="Netflix", merchant_key="netflix"),
    ]
    recurrences = detect_recurrences(rows)
    assert len(recurrences) == 1
    assert recurrences[0].confirmed is False


def test_detect_recurrences_collapses_iof_into_the_same_charge() -> None:
    """O IOF é lançado no MESMO dia da compra internacional; se contasse como
    cobrança própria, o intervalo [0, 31, 0] teria mediana zero e a assinatura
    nunca seria detectada."""
    rows = [
        entry("t1", date="2026-04-10", amount=5000, merchant="Claude.Ai", merchant_key="claude ai"),
        entry("t1b", date="2026-04-10", amount=350, merchant="Iof", merchant_key="claude ai"),
        entry("t2", date="2026-05-10", amount=5000, merchant="Claude.Ai", merchant_key="claude ai"),
        entry("t2b", date="2026-05-10", amount=350, merchant="Iof", merchant_key="claude ai"),
        entry("t3", date="2026-06-10", amount=5000, merchant="Claude.Ai", merchant_key="claude ai"),
        entry("t3b", date="2026-06-10", amount=350, merchant="Iof", merchant_key="claude ai"),
    ]
    recurrences = detect_recurrences(rows)
    assert len(recurrences) == 1
    assert recurrences[0].occurrences == 3
    assert recurrences[0].latest_amount == 5350


def test_detect_recurrences_ignores_irregular_intervals() -> None:
    rows = [
        entry("t1", date="2026-01-01", amount=5000, merchant="Loja", merchant_key="loja"),
        entry("t2", date="2026-01-15", amount=5000, merchant="Loja", merchant_key="loja"),
    ]
    assert detect_recurrences(rows) == []
