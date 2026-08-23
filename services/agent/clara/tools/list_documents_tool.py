"""`@tool` de fronteira para `list_documents`."""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.list_documents import list_documents as _list
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_tenant_caller


@tool(
    name="list_documents",
    description=(
        "Lists uploaded documents INCLUDING the ones no invoice list shows: extraction "
        "failed (no batch) or batch rejected. Use for 'cadê o documento que enviei' and to "
        "resume a stalled upload."
    ),
)
def list_documents_tool(
    run_context: RunContext, without_batch: bool = False, limit: int = 20
) -> dict:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _list(session, caller.tenant_id, without_batch=without_batch, limit=limit)
    return to_tool_result(result)
