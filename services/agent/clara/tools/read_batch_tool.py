"""`@tool` de fronteira para `read_batch`."""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.read_batch import read_batch as _read
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_session_caller


@tool(
    name="read_batch",
    description=(
        "Opens one financial document and returns its entries plus the stored verification "
        "report. Call this before fixing anything in an invoice or statement: the entry ids "
        "you need come from here. Works for drafts and for already recorded documents."
    ),
)
def read_batch_tool(
    run_context: RunContext, batch_id: str, only_suspects: bool = False
) -> dict[str, Any]:
    caller = require_session_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _read(
            session, caller.tenant_id, caller.session_id, batch_id,
            only_suspects=only_suspects,
        )
    return to_tool_dict(result)
