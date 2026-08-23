from __future__ import annotations

from clara.tools.analysis_scope import (
    AllScope,
    CalendarMonthScope,
    InvoiceScope,
    RangeScope,
    canonical_analysis_scope,
    draft_note,
    scope_filter,
    scope_label,
)


def test_range_covering_exactly_one_month_becomes_calendar_month() -> None:
    scope = RangeScope(**{"from": "2026-06-01", "to": "2026-06-30"})
    canonical = canonical_analysis_scope(scope)
    assert isinstance(canonical, CalendarMonthScope)
    assert canonical.month == "2026-06"


def test_range_not_covering_a_whole_month_stays_a_range() -> None:
    scope = RangeScope(**{"from": "2026-06-01", "to": "2026-06-15"})
    canonical = canonical_analysis_scope(scope)
    assert isinstance(canonical, RangeScope)


def test_range_accepts_from_alias_and_field_name() -> None:
    by_alias = RangeScope(**{"from": "2026-06-01", "to": "2026-06-30"})
    by_name = RangeScope(from_="2026-06-01", to="2026-06-30")
    assert by_alias.from_ == by_name.from_ == "2026-06-01"


def test_scope_filter_invoice_includes_proposed() -> None:
    filter_ = scope_filter(InvoiceScope(batch_id="bat_1"))
    assert filter_.batch_id == "bat_1"
    assert filter_.include_proposed is True


def test_scope_filter_calendar_month_expands_to_range() -> None:
    filter_ = scope_filter(CalendarMonthScope(month="2026-02"))
    assert filter_.from_ == "2026-02-01"
    assert filter_.to == "2026-02-28"


def test_scope_label_all_with_issuer() -> None:
    assert scope_label(AllScope(issuer="Nubank")) == "Todo o razão · Nubank"


def test_scope_label_all_without_issuer() -> None:
    assert scope_label(AllScope()) == "Todo o razão"


def test_draft_note_empty_when_nothing_proposed() -> None:
    assert draft_note([{"status": "confirmed"}]) == ""


def test_draft_note_whole_batch_in_review() -> None:
    note = draft_note([{"status": "proposed"}, {"status": "proposed"}])
    assert "em conferência" in note
    assert "nada aqui foi registrado" in note


def test_draft_note_partial() -> None:
    note = draft_note([{"status": "proposed"}, {"status": "confirmed"}])
    assert note == " 1 lançamento ainda está em conferência."
