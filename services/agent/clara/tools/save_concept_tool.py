"""`@tool` de fronteira para `save_concept` — o SEGUNDO GATE."""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.save_concept import LearnedType
from clara.tools.save_concept import save_concept as _save
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_tenant_caller


@tool(
    name="save_concept",
    requires_confirmation=True,
    description=(
        "Requests approval to record a learning about this person — a categorisation rule, a "
        "merchant alias, a learned category. Call when the exact learning is ready to show: the "
        "call itself opens the approval card and executes only after approval. Do not collect a "
        "prose confirmation first."
    ),
)
def save_concept_tool(
    run_context: RunContext,
    concept_id: str,
    concept_type: LearnedType,
    title: str,
    body: str,
    description: str | None = None,
    merchant: str | None = None,
    aliases: list[str] | None = None,
    reason: str | None = None,
) -> dict:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _save(
            session,
            caller.tenant_id,
            caller.user_id,
            concept_id=concept_id,
            concept_type=concept_type,
            title=title,
            body=body,
            description=description,
            merchant=merchant,
            aliases=aliases,
            reason=reason,
        )
    return to_tool_result(result)
