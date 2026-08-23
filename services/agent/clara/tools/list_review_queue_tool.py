"""`@tool` de fronteira para `list_review_queue`."""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.queries.review import ReviewReason
from clara.db.tenant_scope import for_tenant
from clara.tools.list_review_queue import list_review_queue as _list
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_tenant_caller


@tool(
    name="list_review_queue",
    description=(
        "Lists the entries still waiting for human review — no category, low extraction "
        "confidence, or no merchant — oldest first. THIS is how you show WHICH entries are "
        "uncategorised: the ledger state only says how many. Each entry carries date, "
        "description, merchant, value and id, plus why it is in the queue. Filter with "
        "reasons: ['sem_categoria']. If it returns nothing while the state says there is "
        "uncategorised spending, those entries were already attested — repeat with "
        "include_reviewed=true. mark_reviewed takes an entry out of the queue."
    ),
)
def list_review_queue_tool(
    run_context: RunContext,
    reasons: list[ReviewReason] | None = None,
    batch_id: str | None = None,
    include_reviewed: bool = False,
    limit: int = 100,
) -> dict:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _list(
            session,
            caller.tenant_id,
            reasons=reasons,
            batch_id=batch_id,
            include_reviewed=include_reviewed,
            limit=limit,
        )
    return to_tool_result(result)
