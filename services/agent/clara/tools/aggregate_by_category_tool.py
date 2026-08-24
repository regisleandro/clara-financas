"""`@tool` de fronteira para `aggregate_by_category`."""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.aggregate_by_category import aggregate_by_category as _aggregate
from clara.tools.analysis_scope import AnalysisScope
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller


@tool(
    name="aggregate_by_category",
    description=(
        "Sums spending by category over a period. Use for 'quanto gastei', 'com o quê', "
        "'qual categoria pesa mais'. Bars represent purchases; a category with only "
        "credits in the period is called out in the summary instead of a zero-length bar."
    ),
)
def aggregate_by_category_tool(run_context: RunContext, scope: AnalysisScope) -> dict[str, Any]:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        panel = _aggregate(session, caller.tenant_id, scope)
    return to_tool_dict(panel)
