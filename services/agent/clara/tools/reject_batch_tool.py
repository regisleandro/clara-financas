"""`reject_batch`, exposto como `@tool(requires_confirmation=True)`.

Descartar é uma escrita durável — o lote sai de `proposed` para `rejected` e
não volta. Por isso passa pela mesma pausa de aprovação que `commit_batch`,
e não só um "sim" em prosa (o defeito que esta tool existe para corrigir).
"""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.reject_batch import reject_batch as _reject
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller


@tool(
    name="reject_batch",
    requires_confirmation=True,
    description=(
        "Requests approval to discard a proposed invoice that will not be recorded. Use "
        "when the person says the invoice is wrong, duplicated, or unwanted. Saying in the "
        "chat that it was discarded does NOT discard it — without this call the draft stays "
        "alive and comes back in the ledger snapshot every turn."
    ),
)
def reject_batch_tool(run_context: RunContext, batch_id: str, reason: str) -> dict[str, Any]:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _reject(session, caller.tenant_id, caller.user_id, batch_id, reason)
    return to_tool_dict(result)
