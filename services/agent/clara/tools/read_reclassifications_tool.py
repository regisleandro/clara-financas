"""`@tool` de fronteira para `read_reclassifications`."""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.read_reclassifications import read_reclassifications as _read
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_tenant_caller


@tool(
    name="read_reclassifications",
    description=(
        "Reads the reclassification trail: what changed category, when, by whom and why. "
        "Filter by transaction_id for one entry's history, or by by_concept_id to see every "
        "line a learned rule touched — that is how you undo a rule application entirely. "
        "Newest first."
    ),
)
def read_reclassifications_tool(
    run_context: RunContext,
    transaction_id: str | None = None,
    by_concept_id: str | None = None,
    limit: int = 20,
) -> dict:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _read(
            session,
            caller.tenant_id,
            transaction_id=transaction_id,
            by_concept_id=by_concept_id,
            limit=limit,
        )
    return to_tool_result(result)
