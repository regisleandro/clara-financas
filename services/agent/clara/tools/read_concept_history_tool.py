"""`@tool` de fronteira para `read_concept_history`."""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.models import Bundle
from clara.db.tenant_scope import for_tenant
from clara.tools.read_concept_history import LIMIT
from clara.tools.read_concept_history import read_concept_history as _history
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_tenant_caller


@tool(
    name="read_concept_history",
    description=(
        "Reads the revision history of one concept (learned rule, alias, category), newest "
        "first, each with the full body it recorded. To revert a concept, pick the revision and "
        "call save_concept with that body — the revert becomes a new revision, nothing is "
        "erased."
    ),
)
def read_concept_history_tool(
    run_context: RunContext,
    concept_id: str,
    bundle: Bundle = "learnings",
    limit: int = LIMIT,
) -> dict:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _history(
            session, caller.tenant_id, concept_id=concept_id, bundle=bundle, limit=limit
        )
    return to_tool_result(result)
