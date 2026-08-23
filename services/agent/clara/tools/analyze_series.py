"""Evolução de 2 a 12 períodos, em dois painéis — porta de
`agent/subagents/analyst/tools/analyze_series.ts`.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from clara.db.category_labels import load_category_labels
from clara.db.queries.ledger import load_ledger
from clara.ledger.categories import category_label
from clara.ledger.money import format_cents
from clara.ledger.series import FinancialPeriod, analyze_financial_series
from clara.tools.analysis_scope import (
    AnalysisScope,
    canonical_analysis_scope,
    draft_note,
    scope_filter,
)
from clara.views.panels import ComparisonPanel, Metric, MetricPanel, Row, SeriesPanel


@dataclass(frozen=True)
class SeriesPeriodInput:
    id: str
    label: str
    scope: AnalysisScope


def analyze_series(
    session: Session, tenant_id: str, periods: list[SeriesPeriodInput]
) -> tuple[SeriesPanel, ComparisonPanel | None] | MetricPanel:
    loaded = [
        (p, load_ledger(session, tenant_id, scope_filter(canonical_analysis_scope(p.scope))))
        for p in periods
    ]
    all_rows = [row for _, rows in loaded for row in rows]

    empty = [p for p, rows in loaded if not rows]
    if empty:
        # Comparar contra o vazio produziria "subiu tudo" a partir de zero —
        # dizer que não dá para comparar, e qual lado falta, é a resposta completa.
        names = ", ".join(p.label for p in empty)
        return MetricPanel(
            title="Evolução dos gastos",
            summary=(
                f"A evolução não foi calculada: {names} não possui lançamentos. "
                f"Nenhum total foi estimado."
            ),
            metric=Metric(
                label="Resultado",
                text="Dados insuficientes",
                detail=f"Sem lançamentos em: {names}.",
                basis="count",
            ),
        )

    series = analyze_financial_series(
        [FinancialPeriod(id=p.id, label=p.label, transactions=rows) for p, rows in loaded]
    )
    first, last = series.points[0], series.points[-1]
    edge_ids = sorted(set(first.transaction_ids) | set(last.transaction_ids))

    series_panel = SeriesPanel(
        title="Evolução dos gastos",
        summary=(
            f"{first.label} → {last.label}. A série foi calculada diretamente do razão."
            f"{draft_note(all_rows)}"
        ),
        metric=Metric(
            label="Variação no período",
            amount=series.total_delta,
            basis="delta",
            detail=f"{format_cents(first.value)} → {format_cents(last.value)}",
            transaction_ids=edge_ids,
        ),
        rows=[
            Row(label=pt.label, amount=pt.value, transaction_ids=pt.transaction_ids)
            for pt in series.points
        ],
    )

    # Um recorte só de pagamentos e transferências não tem fatores a explicar.
    if not series.drivers:
        return series_panel, None

    labels = load_category_labels(session, tenant_id)
    drivers_panel = ComparisonPanel(
        title="O que explica a mudança",
        summary=f"Fatores entre {first.label} e {last.label}.",
        metric=Metric(
            label="Variação no período",
            amount=series.total_delta,
            basis="delta",
            detail=f"{format_cents(first.value)} → {format_cents(last.value)}",
            transaction_ids=edge_ids,
        ),
        rows=[
            Row(
                label=category_label(labels, d.category),
                amount=d.delta,
                basis="delta",
                detail=(
                    ("Aumentou" if d.delta > 0 else "Diminuiu" if d.delta < 0 else "Estável")
                    + (
                        f" · {round(d.share_of_change * 100)}% do aumento"
                        if d.delta > 0 and d.share_of_change > 0
                        else ""
                    )
                ),
                trend="up" if d.delta > 0 else "down" if d.delta < 0 else "flat",
                transaction_ids=d.transaction_ids,
            )
            for d in series.drivers[:20]
        ],
    )
    return series_panel, drivers_panel
