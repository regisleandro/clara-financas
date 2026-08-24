"""`@tool` de fronteira para `read_tool_events`."""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.read_tool_events import EventStatus
from clara.tools.read_tool_events import read_tool_events as _read
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller


@tool(
    name="read_tool_events",
    description=(
        "Reads the tool execution log: which tool ran, status (ok/recuperavel/falha), error "
        "code, duration. Use for 'o que deu errado', 'por que falhou ontem'. Carries no "
        "financial values by construction — only tool names, ids and counts."
    ),
)
def read_tool_events_tool(
    run_context: RunContext,
    status: EventStatus | None = None,
    tool_name: str | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _read(session, caller.tenant_id, status=status, tool_name=tool_name, limit=limit)
    return to_tool_dict(result)
