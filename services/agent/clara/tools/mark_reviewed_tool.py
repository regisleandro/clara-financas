"""`@tool` de fronteira para `mark_reviewed` — em duas portas porque Agno não
tem confirmação condicional por argumento (só o decorador estático
`requires_confirmation`): `mark_reviewed_tool` cobre até
`NO_CARD_LIMIT` linhas sem cartão, e recusa apontando para
`mark_reviewed_bulk_tool` (gated) acima disso. Reabrir nunca pede cartão —
devolver itens à fila é a direção segura, então segue sempre pela primeira.
"""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.errors import refused
from clara.tools.mark_reviewed import NO_CARD_LIMIT
from clara.tools.mark_reviewed import mark_reviewed as _mark
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_tenant_caller


@tool(
    name="mark_reviewed",
    description=(
        "Marks up to 20 entries as reviewed by the person, or reopens them with reopen=true. "
        "Use when the conclusion is 'the reading was already right' — without it the review "
        "queue keeps handing back the same entries forever. Changes no financial data. For "
        "more than 20 entries (attesting, not reopening), use mark_reviewed_bulk instead."
    ),
)
def mark_reviewed_tool(
    run_context: RunContext, transaction_ids: list[str], reopen: bool = False
) -> dict:
    caller = require_tenant_caller(run_context)
    if not reopen and len(transaction_ids) > NO_CARD_LIMIT:
        return to_tool_result(
            refused(
                "operacao_nao_permitida",
                f"Atestar mais de {NO_CARD_LIMIT} lançamentos de uma vez precisa de aprovação.",
                hint="Chame mark_reviewed_bulk com os mesmos transaction_ids.",
            )
        )
    with for_tenant(caller.tenant_id) as session:
        result = _mark(session, caller.tenant_id, caller.user_id, transaction_ids, reopen=reopen)
    return to_tool_result(result)


@tool(
    name="mark_reviewed_bulk",
    requires_confirmation=True,
    description=(
        "Requests approval to mark MORE THAN 20 entries as reviewed at once — attesting in "
        "bulk empties the review queue, so the person decides. For 20 or fewer, or to reopen "
        "any amount, use mark_reviewed instead (no card)."
    ),
)
def mark_reviewed_bulk_tool(run_context: RunContext, transaction_ids: list[str]) -> dict:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _mark(session, caller.tenant_id, caller.user_id, transaction_ids, reopen=False)
    return to_tool_result(result)
