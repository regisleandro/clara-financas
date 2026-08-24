"""O GATE, exposto como `@tool(requires_confirmation=True)`.

Quando o modelo chama esta ferramenta, o Agno pausa o turno (`RunRequirement`)
até uma pessoa aprovar — via AG-UI, um `ToolMessage` `{"accepted": true}`
resolve a pausa e a execução retoma exatamente aqui (FR-010, FR-011).

A lógica de revalidação pós-aprovação mora em `clara/tools/commit_batch.py`,
testada em isolamento contra Postgres real sem precisar de um modelo — é lá
que FR-012 e FR-013 estão cobertos.
"""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.commit_batch import commit_batch as _commit
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller


@tool(
    name="commit_batch",
    requires_confirmation=True,
    description=(
        "Requests approval to record a verified draft batch in the ledger. Call when the "
        "verification is ready for the person's decision: the call opens the approval "
        "card, pauses, and executes only after approval. Do not ask for a prose "
        "confirmation first."
    ),
)
def commit_batch_tool(
    run_context: RunContext,
    proposal_id: str | None = None,
    batch_id: str | None = None,
) -> dict[str, Any]:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _commit(
            session, caller.tenant_id, caller.user_id, batch_id=batch_id, proposal_id=proposal_id
        )
    return to_tool_dict(result)
