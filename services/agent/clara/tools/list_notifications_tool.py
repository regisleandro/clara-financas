"""`@tool` de fronteira para `list_notifications`."""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.list_notifications import LIMIT
from clara.tools.list_notifications import list_notifications as _list
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller


@tool(
    name="list_notifications",
    description=(
        "Lists the proactive notifications Clara already sent (due-date warnings), newest "
        "first, each with whether the person has seen it. Use for 'que avisos você me deu', and "
        "to avoid repeating a warning already seen."
    ),
)
def list_notifications_tool(
    run_context: RunContext, unread_only: bool = False, limit: int = 20
) -> dict[str, Any]:
    if limit > LIMIT:
        limit = LIMIT
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _list(session, caller.tenant_id, unread_only=unread_only, limit=limit)
    return to_tool_dict(result)
