from __future__ import annotations

from clara.ledger.series import FinancialPeriod, analyze_financial_series
from tests.ledger.test_analysis import entry


def test_analyze_financial_series_orders_chronologically_regardless_of_input_order() -> None:
    """Períodos entregues do mais recente para o mais antigo (como uma pessoa
    fala: "as três últimas faturas") não podem inverter o sinal da variação."""
    junho = FinancialPeriod("jun", "Junho", [entry("t2", date="2026-06-01", amount=20000)])
    maio = FinancialPeriod("mai", "Maio", [entry("t1", date="2026-05-01", amount=10000)])

    series = analyze_financial_series([junho, maio])

    assert [p.id for p in series.points] == ["mai", "jun"]
    assert series.total_delta == 10000


def test_analyze_financial_series_period_without_transactions_goes_last() -> None:
    vazio = FinancialPeriod("vazio", "Vazio", [])
    maio = FinancialPeriod("mai", "Maio", [entry("t1", date="2026-05-01", amount=10000)])

    series = analyze_financial_series([vazio, maio])

    assert [p.id for p in series.points] == ["mai", "vazio"]


def test_analyze_financial_series_drivers_compare_first_and_last_period() -> None:
    first = FinancialPeriod(
        "p1", "P1", [entry("t1", date="2026-01-01", amount=1000, category="food")]
    )
    last = FinancialPeriod(
        "p2", "P2", [entry("t2", date="2026-02-01", amount=9000, category="food")]
    )

    series = analyze_financial_series([first, last])

    assert series.drivers[0].category == "food"
    assert series.drivers[0].delta == 8000
    assert series.drivers[0].share_of_change == 1.0
