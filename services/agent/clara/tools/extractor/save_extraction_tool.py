"""`@tool` de fronteira para `save_extraction` — ver o módulo irmão para a lógica."""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.extractor.save_extraction import save_extraction
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_session_caller
from clara.views.agent_contracts import ExtractionResult


@tool(
    name="save_extraction",
    description=(
        "Persists the complete extraction of a document and returns an extraction_id. "
        "Call EXACTLY ONCE, with every transaction you read, right before returning your "
        "structured result. The coordinator proposes the batch from the extraction_id — "
        "never retype the transactions anywhere else."
    ),
)
def save_extraction_tool(run_context: RunContext, extraction: ExtractionResult) -> dict:
    caller = require_session_caller(run_context)
    parent_session_id = (run_context.dependencies or {}).get("parentSessionId")

    with for_tenant(caller.tenant_id) as session:
        result = save_extraction(
            session, caller.tenant_id, extraction, parent_session_id=parent_session_id
        )
    return to_tool_result(result)
