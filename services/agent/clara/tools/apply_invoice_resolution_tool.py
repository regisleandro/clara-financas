"""`@tool` de fronteira para `apply_invoice_resolution` — o gate."""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.apply_invoice_resolution import (
    apply_invoice_resolution as _apply,
)
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller


@tool(
    name="apply_invoice_resolution",
    requires_confirmation=True,
    description=(
        "Opens the approval gate for a prepared invoice-resolution proposal. Call with the "
        "exact proposal_id returned by prepare_invoice_resolution. Execution revalidates the "
        "invoice revision and current difference, is idempotent, and returns a canonical "
        "receipt."
    ),
)
def apply_invoice_resolution_tool(run_context: RunContext, proposal_id: str) -> dict[str, Any]:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _apply(session, caller.tenant_id, caller.user_id, proposal_id=proposal_id)
    return to_tool_dict(result)
