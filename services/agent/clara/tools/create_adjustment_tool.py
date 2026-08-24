"""`@tool` de fronteira para `create_adjustment`."""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.create_adjustment import create_adjustment as _create
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller


@tool(
    name="create_adjustment",
    requires_confirmation=True,
    description=(
        "Requests approval to record a correction to an entry already confirmed in the "
        "ledger. amount_cents is a DELTA, not a replacement: to fix 100.00 that should be "
        "90.00, pass -1000. The original entry stays untouched and the adjustment sums on "
        "top, so the trail shows both. Use when edit_proposed_batch refuses because the "
        "invoice was already recorded. Entry ids come from read_batch or query_ledger."
    ),
)
def create_adjustment_tool(
    run_context: RunContext,
    transaction_id: str,
    amount_cents: int,
    reason: str,
    date: str | None = None,
) -> dict[str, Any]:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _create(
            session,
            caller.tenant_id,
            caller.user_id,
            transaction_id=transaction_id,
            amount_cents=amount_cents,
            reason=reason,
            date=date,
        )
    return to_tool_dict(result)
