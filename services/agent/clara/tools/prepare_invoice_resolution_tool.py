"""`@tool` de fronteira para `prepare_invoice_resolution`."""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.prepare_invoice_resolution import (
    prepare_invoice_resolution as _prepare,
)
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller


@tool(
    name="prepare_invoice_resolution",
    description=(
        "Prepares a canonical proposal to close the current difference of one already-recorded "
        "invoice. The tool calculates the sign and amount; never calculate or invert it "
        "yourself. target_transaction_id is optional metadata: an id that is not an entry of "
        "this invoice is IGNORED and reported back — the proposal still exists, at invoice "
        "level. After showing the proposal, call apply_invoice_resolution with only its "
        "proposal_id to open the approval gate."
    ),
)
def prepare_invoice_resolution_tool(
    run_context: RunContext,
    batch_id: str,
    reason: str,
    target_transaction_id: str | None = None,
) -> dict[str, Any]:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _prepare(
            session,
            caller.tenant_id,
            caller.user_id,
            batch_id=batch_id,
            target_transaction_id=target_transaction_id,
            reason=reason,
        )
    return to_tool_dict(result)
