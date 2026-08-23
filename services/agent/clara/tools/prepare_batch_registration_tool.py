"""`@tool` de fronteira para `prepare_batch_registration`."""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.prepare_batch_registration import (
    prepare_batch_registration as _prepare,
)
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_tenant_caller


@tool(
    name="prepare_batch_registration",
    description=(
        "Prepares the canonical registration proposal for one draft financial document. "
        "Call immediately before commit_batch, then pass the returned proposal_id to "
        "commit_batch. This freezes the document revision, verification and number of "
        "entries shown in the approval."
    ),
)
def prepare_batch_registration_tool(run_context: RunContext, batch_id: str) -> dict:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _prepare(session, caller.tenant_id, caller.user_id, batch_id)
    return to_tool_result(result)
