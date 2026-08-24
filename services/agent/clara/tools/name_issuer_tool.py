"""`@tool` de fronteira para `name_issuer`."""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.name_issuer import name_issuer as _name
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller


@tool(
    name="name_issuer",
    description=(
        "Names the issuer of a document whose extraction could not identify it — until then "
        "every entry of that invoice falls under 'Sem operadora' in the issuer view. Use when "
        "the person says which card or bank the invoice is from. No approval card: it changes "
        "no financial value."
    ),
)
def name_issuer_tool(run_context: RunContext, document_id: str, issuer: str) -> dict[str, Any]:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _name(session, caller.tenant_id, document_id, issuer)
    return to_tool_dict(result)
