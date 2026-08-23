"""Gasto mês a mês, e por operadora dentro de cada mês — porta de
`agent/subagents/analyst/tools/aggregate_by_month.ts`.

A mesma conta da tela cruzada por operadora (`aggregate_by_issuer_month`),
que antes só a web alcançava — reimplementar a agregação daria dois números
para a mesma pergunta.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from clara.db.queries.ledger import ledger_coverage, load_ledger
from clara.ledger.analysis import aggregate_by_issuer_month
from clara.ledger.money import format_cents
from clara.tools.analysis_scope import (
    AllScope,
    AnalysisScope,
    RangeScope,
    canonical_analysis_scope,
    draft_note,
    scope_filter,
)
from clara.views.panels import BreakdownPanel, Metric, MetricPanel, Row, SeriesPanel


@dataclass(frozen=True)
class _IssuerTotal:
    label: str
    value: int
    count: int
    transaction_ids: list[str]


def _month_label(month: str) -> str:
    names = [
        "janeiro",
        "fevereiro",
        "março",
        "abril",
        "maio",
        "junho",
        "julho",
        "agosto",
        "setembro",
        "outubro",
        "novembro",
        "dezembro",
    ]
    year, month_number = month.split("-")
    return f"{names[int(month_number) - 1]}/{year}"


def aggregate_by_month(
    session: Session,
    tenant_id: str,
    *,
    from_: str | None = None,
    to: str | None = None,
    issuer: str | None = None,
    months: int | None = None,
) -> tuple[MetricPanel | SeriesPanel, BreakdownPanel | None]:
    scope: AnalysisScope = canonical_analysis_scope(
        RangeScope.model_validate({"from": from_, "to": to, "issuer": issuer})
        if from_ is not None and to is not None
        else AllScope(issuer=issuer)
    )
    ledger = load_ledger(session, tenant_id, scope_filter(scope))

    if not ledger:
        coverage = ledger_coverage(session, tenant_id)
        summary = (
            "O razão ainda não tem lançamentos confirmados."
            if coverage.count == 0
            else (
                f"Não há lançamentos nesse recorte. O razão cobre de {coverage.first_date} "
                f"a {coverage.last_date} ({coverage.count} lançamentos)."
            )
        )
        return MetricPanel(
            title="Gasto mês a mês",
            summary=summary,
            metric=Metric(label="Meses com gasto", text="0", basis="count"),
        ), None

    matrix = aggregate_by_issuer_month(ledger)

    # `months` vem do mais recente para o mais antigo; o corte acontece ANTES
    # da inversão, para "os últimos 6 meses" pegar os 6 mais recentes e ainda
    # assim ser lido do mais antigo para o mais novo — como se lê uma série.
    keep = months if months is not None else len(matrix.months)
    positions = list(range(min(keep, len(matrix.months))))[::-1]

    points = [
        (matrix.months[p], _month_label(matrix.months[p]), matrix.month_totals[p])
        for p in positions
    ]
    displayed_ids = [tid for _, _, bucket in points for tid in bucket.transaction_ids]
    displayed_total = sum(bucket.value for _, _, bucket in points)
    omitted = len(matrix.months) - len(points)

    series_panel = SeriesPanel(
        title="Gasto mês a mês",
        summary=(
            f"{points[0][1]} → {points[-1][1]}. O mês é o da compra, não o do fechamento da "
            f"fatura; pagamento de fatura fica fora da soma."
            + (
                f" {omitted} "
                f"{'mês anterior ficou' if omitted == 1 else 'meses anteriores ficaram'} "
                f"fora do recorte."
                if omitted > 0
                else ""
            )
            + draft_note(ledger)
        ),
        metric=Metric(
            label="Total no período",
            amount=displayed_total,
            detail=f"{len(points)} {'mês' if len(points) == 1 else 'meses'}",
            transaction_ids=displayed_ids,
        ),
        rows=[
            Row(
                label=label,
                amount=bucket.value,
                detail=f"{bucket.count} {'lançamento' if bucket.count == 1 else 'lançamentos'}",
                transaction_ids=bucket.transaction_ids,
            )
            for _, label, bucket in points
        ],
    )

    # Composição por operadora: só quando há mais de uma, senão repetiria o
    # total da série numa linha só (ruído).
    by_issuer: list[_IssuerTotal] = []
    for row in matrix.issuers:
        cells = [cell for p in positions if (cell := row.by_month[p]) is not None]
        if not cells:
            continue
        by_issuer.append(
            _IssuerTotal(
                label=row.issuer or "Sem operadora",
                value=sum(c.value for c in cells),
                count=sum(c.count for c in cells),
                transaction_ids=[tid for c in cells for tid in c.transaction_ids],
            )
        )
    by_issuer.sort(key=lambda r: -r.value)

    if len(by_issuer) < 2:
        return series_panel, None

    issuer_panel = BreakdownPanel(
        title="Por operadora no período",
        summary=f"Como o total de {format_cents(displayed_total)} se divide entre as operadoras.",
        metric=Metric(
            label="Total no período", amount=displayed_total, transaction_ids=displayed_ids
        ),
        rows=[
            Row(
                label=r.label,
                amount=r.value,
                detail=f"{r.count} {'lançamento' if r.count == 1 else 'lançamentos'}",
                share=(min(1.0, abs(r.value / displayed_total)) if displayed_total != 0 else None),
                transaction_ids=r.transaction_ids,
            )
            for r in by_issuer
        ],
    )
    return series_panel, issuer_panel
