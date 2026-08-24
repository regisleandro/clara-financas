"""`@tool` de fronteira para `compare_periods`."""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.analysis_scope import ComparableAnalysisScope
from clara.tools.compare_periods import compare_periods as _compare
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller


@tool(
    name="compare_periods",
    description=(
        "Compares spending across two periods by category and shows what accounts for the "
        "change. Use for 'por que subiu', 'comparado ao mês passado'."
    ),
)
def compare_periods_tool(
    run_context: RunContext, current: ComparableAnalysisScope, previous: ComparableAnalysisScope
) -> dict[str, Any]:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        panel = _compare(session, caller.tenant_id, current, previous)
    return to_tool_dict(panel)
