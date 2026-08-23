"""`@tool` de fronteira para `aggregate_by_month`."""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.aggregate_by_month import aggregate_by_month as _aggregate
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_tenant_caller


@tool(
    name="aggregate_by_month",
    description=(
        "Sums spending month by month, and by card issuer within each month. Use for a "
        "SERIES — 'mês a mês', 'os últimos meses', 'a evolução do gasto'. One call returns "
        "every month, each with its own provenance: never ask month by month and never add "
        "the months up yourself. The month is the month of PURCHASE, not of the invoice "
        "closing. For one period use aggregate_by_category; for exactly two use "
        "compare_periods."
    ),
)
def aggregate_by_month_tool(
    run_context: RunContext,
    from_date: str | None = None,
    to_date: str | None = None,
    issuer: str | None = None,
    months: int | None = None,
) -> list[dict]:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        series_panel, issuer_panel = _aggregate(
            session, caller.tenant_id, from_=from_date, to=to_date, issuer=issuer, months=months
        )
    panels = [series_panel] + ([issuer_panel] if issuer_panel is not None else [])
    return [to_tool_result(p) for p in panels]
