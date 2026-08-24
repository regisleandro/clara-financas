"""`@tool` de fronteira para `edit_proposed_batch`."""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool
from pydantic import BaseModel

from clara.db.tenant_scope import for_tenant
from clara.ledger.types import Confidence, EntryKind
from clara.tools.edit_proposed_batch import NewTransaction, TransactionEdit
from clara.tools.edit_proposed_batch import edit_proposed_batch as _edit
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_tenant_caller


class TransactionEditInput(BaseModel):
    transaction_id: str
    date: str | None = None
    amount: int | None = None
    kind: EntryKind | None = None
    extraction_confidence: Confidence | None = None
    category: str | None = None
    merchant: str | None = None
    original_description: str | None = None


class NewTransactionInput(BaseModel):
    date: str
    original_description: str
    amount: int
    merchant: str | None = None
    kind: EntryKind = "purchase"
    category: str | None = None
    page: int | None = None


@tool(
    name="edit_proposed_batch",
    description=(
        "Fixes transactions in a batch that is not yet approved and re-runs the checksum. "
        "Corrects date, amount, kind, category, merchant, description and confidence; removes "
        "entries read by mistake; adds entries the extraction missed. Use when the verification "
        "does not add up, or when the person points out an error on the card. Entry ids come "
        "from read_batch. `kind` is usually the answer: an invoice payment read as a purchase "
        "produces a difference exactly the size of the payment. No approval card: it only "
        "touches a draft, never the confirmed ledger."
    ),
)
def edit_proposed_batch_tool(
    run_context: RunContext,
    batch_id: str,
    edits: list[TransactionEditInput] | None = None,
    remove_transaction_ids: list[str] | None = None,
    add: list[NewTransactionInput] | None = None,
) -> dict:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        result = _edit(
            session,
            caller.tenant_id,
            batch_id=batch_id,
            edits=[
                TransactionEdit(
                    transaction_id=e.transaction_id,
                    date=e.date,
                    amount=e.amount,
                    kind=e.kind,
                    extraction_confidence=e.extraction_confidence,
                    category=e.category,
                    merchant=e.merchant,
                    original_description=e.original_description,
                )
                for e in (edits or [])
            ],
            remove_transaction_ids=remove_transaction_ids,
            add=[
                NewTransaction(
                    date=n.date,
                    original_description=n.original_description,
                    amount=n.amount,
                    merchant=n.merchant,
                    kind=n.kind,
                    category=n.category,
                    page=n.page,
                )
                for n in (add or [])
            ],
        )
    return to_tool_result(result)
