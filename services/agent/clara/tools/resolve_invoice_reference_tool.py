"""`@tool` de fronteira para `resolve_invoice_focus` — porta de
`agent/tools/resolve_invoice_reference.ts`.

Existia como função de domínio (`clara/tools/invoice_focus.py`) sem nenhum
`@tool` que a alcançasse — `coordinator.md` já instruía o modelo a chamar
`resolve_invoice_reference` para "essa fatura"/"a última fatura", mas a
ferramenta nunca foi ligada. Achado relendo o prompt contra o inventário real
de tools, não hipotético.
"""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.tools.errors import not_found
from clara.tools.invoice_focus import InvoiceReference, resolve_invoice_focus
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_session_caller


@tool(
    name="resolve_invoice_reference",
    description=(
        "Resolves a spoken invoice reference to its batch_id and sets it as the session's "
        "active invoice. `active` — the invoice currently being discussed; use it for "
        "'essa fatura'/'nesta fatura'. `latest` — the most recent invoice ('a última "
        "fatura'), preferring a credit card invoice over a bank statement or receipt when "
        "both exist. `next_with_divergence` — idempotent: while the active invoice still "
        "has a checksum mismatch, it keeps returning that same one; pass skip_active=true "
        "only when the person explicitly asks for ANOTHER invoice after this one."
    ),
)
def resolve_invoice_reference_tool(
    run_context: RunContext, reference: InvoiceReference, skip_active: bool = False
) -> dict[str, Any]:
    caller = require_session_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        focus = resolve_invoice_focus(
            session, caller.tenant_id, caller.session_id, reference, skip_active=skip_active
        )
        if focus is None:
            return to_tool_dict(
                not_found(
                    "referencia_de_fatura_nao_encontrada",
                    "Não encontrei uma fatura para essa referência.",
                    hint=(
                        "Nenhum documento corresponde a este critério ainda — confira com a "
                        "pessoa qual fatura ela quer dizer, ou ofereça enviar uma."
                    ),
                )
            )
    return to_tool_dict(focus)
