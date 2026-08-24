"""`@tool` de fronteira para `save_commitment`."""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.save_commitment import CommitmentKind
from clara.tools.save_commitment import save_commitment as _save
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller


@tool(
    name="save_commitment",
    requires_confirmation=True,
    description=(
        "Requests approval to record a due date or reminder. Call when date, recurrence and "
        "warning lead time are ready to show; the call opens the decision card and executes "
        "only after approval. Saving over an existing (kind, counterparty) REACTIVATES a "
        "deactivated reminder — never do that for one the person just turned off with "
        "deactivate_commitment."
    ),
)
def save_commitment_tool(
    run_context: RunContext,
    kind: CommitmentKind,
    title: str,
    due_date: str,
    counterparty: str | None = None,
    recurrence_day_of_month: int | None = None,
    expected_amount: int | None = None,
    remind_days_before: int = 3,
) -> dict[str, Any]:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _save(
            session,
            caller.tenant_id,
            kind=kind,
            title=title,
            due_date=due_date,
            counterparty=counterparty,
            recurrence_day_of_month=recurrence_day_of_month,
            expected_amount=expected_amount,
            remind_days_before=remind_days_before,
        )
    return to_tool_dict(result)
