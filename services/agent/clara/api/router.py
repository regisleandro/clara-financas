"""Rotas de leitura para as telas — porta parcial de `apps/web/lib/{overview,ledger}.ts`.

Cada rota chama a MESMA função que a ferramenta correspondente da conversa
chama (FR-017): não existe um segundo caminho de cálculo para o mesmo número,
só uma segunda fachada HTTP sobre o mesmo `clara/ledger/analysis.py`.
"""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from clara.api.auth import require_api_caller
from clara.db.tenant_scope import for_tenant
from clara.tools.aggregate_by_category import aggregate_by_category as _aggregate_by_category
from clara.tools.aggregate_by_month import aggregate_by_month as _aggregate_by_month
from clara.tools.analysis_scope import AllScope, CalendarMonthScope
from clara.tools.compare_periods import compare_periods as _compare_periods
from clara.tools.overview import build_overview as _build_overview
from clara.tools.query_ledger import query_ledger as _query_ledger

router = APIRouter(prefix="/api/ledger", tags=["ledger"])


@router.get("/overview")
def overview(
    request: Request, month: str | None = None, issuer: str | None = None
) -> dict[str, object]:
    caller = require_api_caller(request)
    with for_tenant(caller.tenant_id) as session:
        result = _build_overview(session, caller.tenant_id, month=month, issuer=issuer)
    return {
        "months": result.months,
        "issuers": [{"key": i.key, "label": i.label} for i in result.issuers],
        "selectedMonth": result.selected_month,
        "selectedIssuer": result.selected_issuer,
        "total": result.total,
        "credits": result.credits,
        "net": result.net,
        "comparison": (
            None
            if result.comparison is None
            else {
                "previousMonth": result.comparison.previous_month,
                "previousTotal": result.comparison.previous_total,
                "delta": result.comparison.delta,
                "deltaPercent": result.comparison.delta_percent,
            }
        ),
        "spark": result.spark,
        "range": None if result.range is None else {"from": result.range[0], "to": result.range[1]},
        "categories": [
            {
                "category": c.category,
                "label": c.label,
                "value": c.value,
                "share": c.share,
                "count": c.count,
            }
            for c in result.categories
        ],
        "insight": (
            None
            if result.insight is None
            else {
                "category": result.insight.category,
                "label": result.insight.label,
                "deltaRatio": result.insight.delta_ratio,
            }
        ),
    }


@router.get("/category-breakdown")
def category_breakdown(
    request: Request, month: str | None = None, issuer: str | None = None
) -> dict[str, object]:
    caller = require_api_caller(request)
    scope = (
        AllScope(issuer=issuer) if month is None else CalendarMonthScope(month=month, issuer=issuer)
    )
    with for_tenant(caller.tenant_id) as session:
        panel = _aggregate_by_category(session, caller.tenant_id, scope)
    return panel.model_dump(mode="json")


@router.get("/month-series")
def month_series(
    request: Request,
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    issuer: str | None = None,
    months: int | None = None,
) -> list[dict[str, object]]:
    caller = require_api_caller(request)
    with for_tenant(caller.tenant_id) as session:
        series_panel, issuer_panel = _aggregate_by_month(
            session, caller.tenant_id, from_=from_date, to=to_date, issuer=issuer, months=months
        )
    panels = [series_panel, *([issuer_panel] if issuer_panel is not None else [])]
    return [p.model_dump(mode="json") for p in panels]


@router.get("/compare")
def compare(request: Request, current_month: str, previous_month: str) -> dict[str, object]:
    caller = require_api_caller(request)
    with for_tenant(caller.tenant_id) as session:
        panel = _compare_periods(
            session,
            caller.tenant_id,
            CalendarMonthScope(month=current_month),
            CalendarMonthScope(month=previous_month),
        )
    return panel.model_dump(mode="json")


@router.get("/transactions")
def transactions(
    request: Request,
    month: str | None = None,
    issuer: str | None = None,
    search: str | None = None,
    category: str | None = None,
) -> dict[str, object]:
    caller = require_api_caller(request)
    scope = (
        AllScope(issuer=issuer) if month is None else CalendarMonthScope(month=month, issuer=issuer)
    )
    with for_tenant(caller.tenant_id) as session:
        panel = _query_ledger(
            session, caller.tenant_id, scope=scope, search=search, category=category
        )
    return panel.model_dump(mode="json")
