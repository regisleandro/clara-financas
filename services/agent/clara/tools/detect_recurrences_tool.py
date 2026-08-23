"""`@tool` de fronteira para `detect_recurrences`."""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.analysis_scope import AnalysisScope
from clara.tools.detect_recurrences import detect_recurrences as _detect
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_tenant_caller


@tool(
    name="detect_recurrences",
    description=(
        "Finds charges that repeat monthly at the same merchant, with annualised cost and "
        "price drift since the first charge. Use for 'assinaturas', 'cobranças repetidas', "
        "'onde posso economizar'."
    ),
)
def detect_recurrences_tool(
    run_context: RunContext, scope: AnalysisScope | None = None, min_occurrences: int = 2
) -> dict:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        panel = _detect(session, caller.tenant_id, scope, min_occurrences=min_occurrences)
    return to_tool_result(panel)
