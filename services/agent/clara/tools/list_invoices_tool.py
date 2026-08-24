"""`@tool` de fronteira para `list_invoices`."""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.list_invoices import list_invoices as _list
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller


@tool(
    name="list_invoices",
    description=(
        "Lists financial documents already sent by this person, newest first (or oldest "
        "first), each with cycle, due date, entry count and BOTH totals — declared (may be "
        "null) and extracted. Use for document history, 'quais faturas eu tenho', or a "
        "month-by-month reading."
    ),
)
def list_invoices_tool(
    run_context: RunContext, limit: int = 20, oldest_first: bool = False
) -> list[dict[str, Any]]:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        rows = _list(session, caller.tenant_id, limit=limit, oldest_first=oldest_first)
    return [to_tool_dict(r) for r in rows]
