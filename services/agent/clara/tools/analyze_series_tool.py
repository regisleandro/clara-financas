"""`@tool` de fronteira para `analyze_series`."""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool
from pydantic import BaseModel

from clara.db.tenant_scope import for_tenant
from clara.tools.analysis_scope import AnalysisScope
from clara.tools.analyze_series import SeriesPeriodInput
from clara.tools.analyze_series import analyze_series as _analyze
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller


class PeriodInput(BaseModel):
    id: str
    label: str
    scope: AnalysisScope


@tool(
    name="analyze_series",
    description=(
        "Calculates spending evolution across 2 to 12 periods and shows what explains the "
        "change. Use to compare several invoices, months, or the evolution over time. Never "
        "compute the values in text; return the panels."
    ),
)
def analyze_series_tool(
    run_context: RunContext, periods: list[PeriodInput]
) -> list[dict[str, Any]] | dict[str, Any]:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _analyze(
            session,
            caller.tenant_id,
            [SeriesPeriodInput(id=p.id, label=p.label, scope=p.scope) for p in periods],
        )
    if isinstance(result, tuple):
        series_panel, drivers_panel = result
        panels = [series_panel] + ([drivers_panel] if drivers_panel is not None else [])
        return [to_tool_dict(p) for p in panels]
    return to_tool_dict(result)
