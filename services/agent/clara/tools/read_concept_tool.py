"""`@tool` de fronteira para `read_concept`."""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.models import Bundle
from clara.db.tenant_scope import for_tenant
from clara.tools.read_concept import read_concept as _read
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller


@tool(
    name="read_concept",
    description=(
        "Reads concepts from the user's knowledge. Use to consult categories, conventions and "
        "rules from the constitution, or what has been learned about the person, before "
        "deciding a category or applying a rule. bundle='constitution' for the domain contract; "
        "'learnings' for what has been learned about this person. Omit concept_id to list the "
        "whole bundle."
    ),
)
def read_concept_tool(
    run_context: RunContext,
    bundle: Bundle,
    concept_id: str | None = None,
    concept_type: str | None = None,
    prefix: str | None = None,
) -> dict[str, Any]:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _read(
            session,
            caller.tenant_id,
            bundle=bundle,
            concept_id=concept_id,
            concept_type=concept_type,
            prefix=prefix,
        )
    return to_tool_dict(result)
