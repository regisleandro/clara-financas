"""`@tool` de fronteira para `set_proactivity`."""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.serialize import to_tool_result
from clara.tools.set_proactivity import set_proactivity as _set
from clara.tools.tenant import require_tenant_caller


@tool(
    name="set_proactivity",
    requires_confirmation=True,
    description=(
        "Requests approval to turn Clara's proactive warnings ON or OFF as a whole (the daily "
        "due-date sweep). Individual reminders have deactivate_commitment; this is the master "
        "switch. Use when the person says they do not want automatic warnings at all — or wants "
        "them back."
    ),
)
def set_proactivity_tool(run_context: RunContext, enabled: bool, reason: str | None = None) -> dict:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _set(session, caller.tenant_id, caller.user_id, enabled=enabled, reason=reason)
    return to_tool_result(result)
