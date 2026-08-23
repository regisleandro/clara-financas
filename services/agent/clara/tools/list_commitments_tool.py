"""`@tool` de fronteira para `list_commitments`."""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.list_commitments import list_commitments as _list
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_tenant_caller


@tool(
    name="list_commitments",
    description=(
        "Lists active due dates and reminders, with how many days remain. Use to answer what is "
        "coming due."
    ),
)
def list_commitments_tool(run_context: RunContext, within_days: int | None = None) -> dict:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _list(session, caller.tenant_id, within_days=within_days)
    return to_tool_result(result)
