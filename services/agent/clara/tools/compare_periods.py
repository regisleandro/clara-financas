"""Comparação entre dois períodos — porta de
`agent/subagents/analyst/tools/compare_periods.ts`.

`share_of_change` sustenta "restaurantes explicam 62% do aumento": a
contribuição da categoria para a variação, não a variação dela isolada.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from clara.db.category_labels import load_category_labels
from clara.db.queries.ledger import ledger_coverage, load_ledger
from clara.ledger.analysis import compare_periods as _compare
from clara.ledger.analysis import total_spend
from clara.ledger.categories import category_label
from clara.ledger.money import format_cents
from clara.tools.analysis_scope import (
    AnalysisScope,
    canonical_analysis_scope,
    draft_note,
    scope_filter,
    scope_label,
)
from clara.views.panels import ComparisonPanel, Metric, MetricPanel, Row


def compare_periods(
    session: Session, tenant_id: str, current: AnalysisScope, previous: AnalysisScope
) -> ComparisonPanel | MetricPanel:
    current_scope = canonical_analysis_scope(current)
    previous_scope = canonical_analysis_scope(previous)

    current_rows = load_ledger(session, tenant_id, scope_filter(current_scope))
    previous_rows = load_ledger(session, tenant_id, scope_filter(previous_scope))

    # Por LADO, não os dois juntos: um recorte que existe mas voltou vazio
    # (batch_id rejeitado, mês em que a fatura não caiu) faria a comparação
    # rodar contra base zero, e o resultado pareceria "subiu" contra nada.
    if not current_rows or not previous_rows:
        coverage = ledger_coverage(session, tenant_id)
        empty = " e ".join(
            [
                *([f"atual ({scope_label(current_scope)})"] if not current_rows else []),
                *([f"anterior ({scope_label(previous_scope)})"] if not previous_rows else []),
            ]
        )
        detail = (
            "O razão ainda não possui lançamentos confirmados."
            if coverage.count == 0
            else f"A cobertura disponível vai de {coverage.first_date} a {coverage.last_date}."
        )
        return MetricPanel(
            title="Comparação indisponível",
            summary=f"O lado {empty} não possui lançamentos; nenhum delta foi calculado.",
            metric=Metric(label="Resultado", text="Dados insuficientes", detail=detail),
        )

    total_delta, categories = _compare(current_rows, previous_rows)
    labels = load_category_labels(session, tenant_id)
    current_total = total_spend(current_rows)
    previous_total = total_spend(previous_rows)
    total_ids = sorted(set(current_total.transaction_ids) | set(previous_total.transaction_ids))

    return ComparisonPanel(
        title="Comparação de gastos",
        summary=(
            "A variação e suas causas foram calculadas diretamente do razão."
            f"{draft_note([*current_rows, *previous_rows])}"
        ),
        metric=Metric(
            label="Diferença",
            amount=total_delta,
            basis="delta",
            detail=f"{format_cents(previous_total.value)} → {format_cents(current_total.value)}",
            transaction_ids=total_ids,
        ),
        rows=[
            Row(
                label=category_label(labels, c.category),
                amount=c.delta,
                basis="delta",
                # A contribuição vai por EXTENSO, não como `share`: a base dela
                # são só os aumentos, e emiti-la como `share` desenharia uma
                # barra de proporção sobre uma base que o painel não mostra.
                detail=(
                    f"{format_cents(c.previous.value)} → {format_cents(c.current.value)}"
                    + (
                        f" · {round(c.share_of_change * 100)}% do aumento"
                        if c.delta > 0 and c.share_of_change > 0
                        else ""
                    )
                ),
                trend="up" if c.delta > 0 else "down" if c.delta < 0 else "flat",
                transaction_ids=sorted(
                    set(c.current.transaction_ids) | set(c.previous.transaction_ids)
                ),
            )
            for c in categories
        ],
    )
