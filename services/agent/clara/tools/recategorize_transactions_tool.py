"""`@tool` de fronteira para `recategorize_transactions`."""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool
from pydantic import BaseModel

from clara.db.tenant_scope import for_tenant
from clara.tools.recategorize_transactions import CategoryChange
from clara.tools.recategorize_transactions import recategorize_transactions as _recategorize
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_tenant_caller


class CategoryChangeInput(BaseModel):
    transaction_id: str
    category: str
    category_label: str


@tool(
    name="recategorize_transactions",
    requires_confirmation=True,
    description=(
        "Requests approval to change categories on already-confirmed entries. Every category "
        "write, including one entry, opens the approval card."
    ),
)
def recategorize_transactions_tool(
    run_context: RunContext,
    changes: list[CategoryChangeInput],
    reason: str | None = None,
    by_concept_id: str | None = None,
) -> dict:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _recategorize(
            session,
            caller.tenant_id,
            caller.user_id,
            [CategoryChange(c.transaction_id, c.category, c.category_label) for c in changes],
            reason=reason,
            by_concept_id=by_concept_id,
        )
    return to_tool_result(result)
