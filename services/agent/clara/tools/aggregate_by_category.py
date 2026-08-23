"""Composição do gasto por categoria — porta de
`agent/subagents/analyst/tools/aggregate_by_category.ts`.

Bruto em tudo — topo e linhas na MESMA escala. As linhas são as COMPRAS da
categoria; o líquido (compras + créditos) e os créditos isolados viajam só no
`detail`, nomeados. Ver `clara/ledger/analysis.py` para por que a separação
mora no kernel, não aqui.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from clara.db.category_labels import load_category_labels
from clara.db.queries.ledger import ledger_coverage, load_ledger
from clara.ledger.analysis import aggregate_by_category as _aggregate
from clara.ledger.categories import category_label
from clara.ledger.money import format_cents
from clara.tools.analysis_scope import (
    AnalysisScope,
    canonical_analysis_scope,
    draft_note,
    scope_filter,
    scope_label,
)
from clara.views.panels import BreakdownPanel, Metric, MetricPanel, Row


def aggregate_by_category(
    session: Session, tenant_id: str, scope: AnalysisScope
) -> MetricPanel | BreakdownPanel:
    scope = canonical_analysis_scope(scope)
    ledger = load_ledger(session, tenant_id, scope_filter(scope))
    label = scope_label(scope)

    if not ledger:
        coverage = ledger_coverage(session, tenant_id)
        detail = (
            "O razão ainda não tem lançamentos confirmados."
            if coverage.count == 0
            else (
                f"O razão possui dados de {coverage.first_date} a {coverage.last_date}, "
                f"mas não neste recorte."
            )
        )
        return MetricPanel(
            title="Gastos no período",
            summary=f"O recorte {label} não possui lançamentos.",
            metric=Metric(label="Resultado", text="Sem lançamentos", detail=detail),
        )

    labels = load_category_labels(session, tenant_id)
    totals = _aggregate(ledger)

    gross_total = sum(t.gross.value for t in totals)
    credit_total = sum(t.credits.value for t in totals)
    net_total = sum(t.value for t in totals)

    only_credits = [t for t in totals if t.gross.value == 0 and t.credits.value != 0]
    rows = [
        Row(
            label=category_label(labels, t.category),
            amount=t.gross.value,
            detail=(
                f"Compras {format_cents(t.gross.value)}"
                if t.credits.value == 0
                else (
                    f"Compras {format_cents(t.gross.value)} · "
                    f"créditos {format_cents(t.credits.value)}"
                )
            ),
            share=t.share if t.share > 0 else None,
            # A proveniência da LINHA acompanha o valor da linha: só as compras.
            transaction_ids=t.gross.transaction_ids,
        )
        for t in totals
        if t.gross.value > 0
    ]

    credit_note = (
        ""
        if not only_credits
        else " "
        + "; ".join(
            f"{category_label(labels, t.category)} teve apenas créditos "
            f"({format_cents(t.credits.value)})"
            for t in only_credits
        )
        + "."
    )

    if not rows:
        # `amount` é 0 mas não é incondicional: as compras são zero PORQUE só
        # houve crédito neste recorte, e são os créditos que provam isso —
        # uma métrica que soma lançamentos exige testemunha, mesmo somando zero.
        return MetricPanel(
            title="Composição dos gastos",
            summary=f"{label} não teve compras.{credit_note}{draft_note(ledger)}",
            metric=Metric(
                label="Compras no período",
                amount=0,
                detail=f"créditos {format_cents(credit_total)} · líquido {format_cents(net_total)}",
                transaction_ids=[tid for t in totals for tid in t.credits.transaction_ids],
            ),
        )

    return BreakdownPanel(
        title="Composição dos gastos",
        summary=(
            f"{label}. As barras representam compras; as linhas somam o total.{draft_note(ledger)}"
            if credit_total == 0
            else (
                f"{label}. As barras representam compras; os créditos do período "
                f"estão no topo.{credit_note}{draft_note(ledger)}"
            )
        ),
        metric=Metric(
            label="Compras no período",
            amount=gross_total,
            detail=(
                label
                if credit_total == 0
                else (
                    f"{label} · créditos {format_cents(credit_total)} · "
                    f"líquido {format_cents(net_total)}"
                )
            ),
            transaction_ids=[tid for t in totals for tid in t.gross.transaction_ids],
        ),
        rows=rows,
    )
