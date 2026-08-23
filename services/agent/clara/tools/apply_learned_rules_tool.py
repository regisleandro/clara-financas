"""`@tool` de fronteira para `apply_learned_rules` — em duas portas porque
Agno não tem confirmação condicional por argumento (`dryRun` no original
decidia "not-applicable" vs "user-approval" dentro da MESMA tool):
`apply_learned_rules_preview` simula sem gravar nada, e
`apply_learned_rules` (gated) só grava quando `expected_transaction_ids`
bate com a simulação mais recente.
"""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.apply_learned_rules import apply_learned_rules as _apply
from clara.tools.apply_learned_rules import preview_learned_rules as _preview
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_tenant_caller


@tool(
    name="apply_learned_rules_preview",
    description=(
        "Previews what applying learned categorisation rules WOULD do, without writing "
        "anything. Call this first. If there are matches, call apply_learned_rules with the "
        "exact transaction_ids from this preview to open the approval card."
    ),
)
def apply_learned_rules_preview_tool(run_context: RunContext) -> dict:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _preview(session, caller.tenant_id)
    return to_tool_result(result)


@tool(
    name="apply_learned_rules",
    requires_confirmation=True,
    description=(
        "Requests approval to apply learned categorisation rules to the transactions listed by "
        "the immediately preceding apply_learned_rules_preview call. expected_transaction_ids "
        "must match that preview exactly, or the write is refused — the scope changed and needs "
        "a fresh preview."
    ),
)
def apply_learned_rules_tool(run_context: RunContext, expected_transaction_ids: list[str]) -> dict:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _apply(
            session,
            caller.tenant_id,
            caller.user_id,
            expected_transaction_ids=expected_transaction_ids,
        )
    return to_tool_result(result)
