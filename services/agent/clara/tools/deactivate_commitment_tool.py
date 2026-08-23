"""`@tool` de fronteira para `deactivate_commitment`."""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.deactivate_commitment import deactivate_commitment as _deactivate
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_tenant_caller


@tool(
    name="deactivate_commitment",
    requires_confirmation=True,
    description=(
        "Requests approval to deactivate a reminder: the daily sweep stops warning about it, "
        "history is kept. Use when the person asks to stop being reminded. Ids come from "
        "list_commitments. Note save_commitment on the same (kind, counterparty) would "
        "reactivate it — do not recreate a reminder the person just turned off."
    ),
)
def deactivate_commitment_tool(run_context: RunContext, commitment_id: str) -> dict:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _deactivate(session, caller.tenant_id, commitment_id)
    return to_tool_result(result)
