"""Evolução entre vários períodos. Porta de `packages/ledger/src/series.ts`."""

from __future__ import annotations

from dataclasses import dataclass, field

from clara.ledger.analysis import aggregate_by_category, total_spend
from clara.ledger.types import LedgerEntry


@dataclass(frozen=True)
class FinancialPeriod:
    id: str
    label: str
    transactions: list[LedgerEntry]


@dataclass(frozen=True)
class FinancialSeriesPoint:
    id: str
    label: str
    value: int
    transaction_ids: list[str]


@dataclass(frozen=True)
class FinancialSeriesDriver:
    category: str | None
    delta: int
    transaction_ids: list[str]
    share_of_change: float


@dataclass(frozen=True)
class FinancialSeries:
    points: list[FinancialSeriesPoint] = field(default_factory=list)
    total_delta: int = 0
    largest: FinancialSeriesPoint | None = None
    smallest: FinancialSeriesPoint | None = None
    drivers: list[FinancialSeriesDriver] = field(default_factory=list)


def analyze_financial_series(periods: list[FinancialPeriod]) -> FinancialSeries:
    """Compara vários períodos sem passar pelo modelo.

    A ordem vem dos DADOS (a data mais antiga de cada período), não da ordem
    de entrada: um modelo que lista "as três últimas faturas" do mais recente
    para o mais antigo inverteria o sinal da variação se a ordem de chegada
    decidisse. Período sem lançamento não tem âncora e fica no fim — usá-lo
    como base tornaria a variação uma comparação contra o vazio.
    """
    if not periods:
        return FinancialSeries()

    def anchor(period: FinancialPeriod) -> str | None:
        dates = [t["date"] for t in period.transactions]
        return min(dates) if dates else None

    chronological = sorted(
        periods,
        key=lambda p: (anchor(p) is None, anchor(p) or ""),
    )

    points = [
        FinancialSeriesPoint(
            id=p.id,
            label=p.label,
            value=(spend := total_spend(p.transactions)).value,
            transaction_ids=spend.transaction_ids,
        )
        for p in chronological
    ]

    first, last = chronological[0], chronological[-1]
    first_categories = {t.category: t for t in aggregate_by_category(first.transactions)}
    last_categories = {t.category: t for t in aggregate_by_category(last.transactions)}
    categories = set(first_categories) | set(last_categories)
    total_increase = sum(
        max(
            0,
            (last_categories.get(c).value if c in last_categories else 0)
            - (first_categories.get(c).value if c in first_categories else 0),
        )
        for c in categories
    )

    drivers = []
    for category in categories:
        before = first_categories.get(category)
        after = last_categories.get(category)
        delta = (after.value if after is not None else 0) - (
            before.value if before is not None else 0
        )
        ids = sorted(
            {
                *(before.transaction_ids if before is not None else []),
                *(after.transaction_ids if after is not None else []),
            }
        )
        drivers.append(
            FinancialSeriesDriver(
                category=category,
                delta=delta,
                transaction_ids=ids,
                share_of_change=0.0 if total_increase == 0 else max(0, delta) / total_increase,
            )
        )
    drivers.sort(key=lambda d: -d.delta)

    largest = max(points, key=lambda p: p.value, default=None)
    smallest = min(points, key=lambda p: p.value, default=None)

    return FinancialSeries(
        points=points,
        total_delta=points[-1].value - points[0].value,
        largest=largest,
        smallest=smallest,
        drivers=drivers,
    )
