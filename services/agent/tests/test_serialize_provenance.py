"""`to_tool_result` é o ponto único de exigência de proveniência (FR-016):
todo painel passa por ele antes de alcançar o modelo."""

from __future__ import annotations

from clara.tools.serialize import to_tool_result
from clara.views.panels import BreakdownPanel, InvoicesPanel, Metric, Row


def test_to_tool_result_refuses_a_panel_missing_provenance() -> None:
    panel = BreakdownPanel(
        title="Gasto por categoria",
        rows=[Row(label="Mercado", amount=1000)],  # sem transaction_ids
    )

    result = to_tool_result(panel)

    assert isinstance(result, dict)
    assert result["error"]["code"] == "painel_sem_proveniencia"


def test_to_tool_result_passes_through_a_panel_with_provenance() -> None:
    panel = BreakdownPanel(
        title="Gasto por categoria",
        rows=[Row(label="Mercado", amount=1000, transaction_ids=["txn_1"])],
    )

    result = to_tool_result(panel)

    assert result["kind"] == "breakdown"
    assert result["rows"][0]["transaction_ids"] == ["txn_1"]


def test_to_tool_result_invoices_panel_needs_no_provenance() -> None:
    panel = InvoicesPanel(title="Faturas", rows=[Row(label="Nubank · 07/2026", amount=50000)])

    result = to_tool_result(panel)

    assert result["kind"] == "invoices"


def test_to_tool_result_metric_zero_still_requires_ids() -> None:
    panel = BreakdownPanel(
        title="x",
        metric=Metric(label="Total", amount=0),
        rows=[Row(label="a", amount=0, transaction_ids=["t"])],
    )

    result = to_tool_result(panel)

    assert isinstance(result, dict)
    assert result["error"]["code"] == "painel_sem_proveniencia"
