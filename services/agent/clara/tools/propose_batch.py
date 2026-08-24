"""`propose_batch` e `propose_batch_from_extraction` — `@tool` de fronteira
sobre `write_proposed_batch`. Porta de `agent/tools/propose_batch.ts` e
`propose_batch_from_extraction.ts`.
"""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool
from pydantic import BaseModel
from sqlalchemy import select

from clara.db.models import ExtractionStaging
from clara.db.tenant_scope import for_tenant
from clara.ledger.types import Confidence, EntryKind
from clara.tools.errors import not_found
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller
from clara.tools.write_proposed_batch import (
    ProposedBatchWriteInput,
    ProposedTransactionInput,
)
from clara.tools.write_proposed_batch import write_proposed_batch as _write


class InstallmentInput(BaseModel):
    current: int
    total: int


class TransactionInput(BaseModel):
    date: str
    original_description: str
    amount: int
    extraction_confidence: Confidence
    merchant: str | None = None
    kind: EntryKind = "purchase"
    installment: InstallmentInput | None = None
    category: str | None = None
    page: int | None = None


def _to_domain(t: TransactionInput) -> ProposedTransactionInput:
    return ProposedTransactionInput(
        date=t.date, original_description=t.original_description, amount=t.amount,
        extraction_confidence=t.extraction_confidence, merchant=t.merchant, kind=t.kind,
        installment_current=t.installment.current if t.installment else None,
        installment_total=t.installment.total if t.installment else None,
        category=t.category, page=t.page,
    )


@tool(
    name="propose_batch",
    description=(
        "Proposes a draft batch assembled in conversation — a few lines dictated by the "
        "person. For a document the extractor read, use propose_batch_from_extraction "
        "instead; never retype the extractor's transactions here."
    ),
)
def propose_batch(
    run_context: RunContext,
    document_id: str,
    transactions: list[TransactionInput],
    document_kind: str | None = None,
    issuer: str | None = None,
    period_start: str | None = None,
    period_end: str | None = None,
    due_date: str | None = None,
    declared_total: int | None = None,
    opening_balance: int | None = None,
    closing_balance: int | None = None,
    overwrite_edited_draft: bool = False,
) -> dict[str, Any]:
    caller = require_tenant_caller(run_context)
    write_input = ProposedBatchWriteInput(
        document_id=document_id,
        transactions=[_to_domain(t) for t in transactions],
        document_kind=document_kind,  # type: ignore[arg-type]
        issuer=issuer, period_start=period_start, period_end=period_end, due_date=due_date,
        declared_total=declared_total, opening_balance=opening_balance,
        closing_balance=closing_balance, overwrite_edited_draft=overwrite_edited_draft,
    )
    with for_tenant(caller.tenant_id) as session:
        result = _write(session, caller.tenant_id, write_input)
    return to_tool_dict(result)


@tool(
    name="propose_batch_from_extraction",
    description=(
        "Proposes a draft batch from a persisted extraction (extraction_id from "
        "save_extraction's receipt). This is the reference path — the coordinator never "
        "retypes the transactions the extractor read."
    ),
)
def propose_batch_from_extraction(
    run_context: RunContext,
    extraction_id: str,
    overwrite_edited_draft: bool = False,
) -> dict[str, Any]:
    caller = require_tenant_caller(run_context)

    with for_tenant(caller.tenant_id) as session:
        staging = session.execute(
            select(ExtractionStaging).where(
                ExtractionStaging.id == extraction_id,
                ExtractionStaging.tenant_id == caller.tenant_id,
            )
        ).scalar_one_or_none()

        if staging is None:
            return to_tool_dict(
                not_found(
                    "extracao_nao_encontrada", f"Nenhuma extração com o id {extraction_id}.",
                    hint="Chame save_extraction de novo, ou confira o extraction_id do recibo.",
                )
            )

        payload = staging.payload
        write_input = ProposedBatchWriteInput(
            document_id=payload["document_id"],
            document_kind=payload.get("document_kind"),
            issuer=payload.get("issuer"),
            period_start=payload.get("period_start"),
            period_end=payload.get("period_end"),
            due_date=payload.get("due_date"),
            declared_total=payload.get("declared_total"),
            declared_subtotals=payload.get("declared_subtotals"),
            opening_balance=payload.get("opening_balance"),
            closing_balance=payload.get("closing_balance"),
            overwrite_edited_draft=overwrite_edited_draft,
            transactions=[
                ProposedTransactionInput(
                    date=t["date"], original_description=t["original_description"],
                    amount=t["amount"], extraction_confidence=t["extraction_confidence"],
                    merchant=t.get("merchant"), kind=t.get("kind", "purchase"),
                    installment_current=(t.get("installment") or {}).get("current"),
                    installment_total=(t.get("installment") or {}).get("total"),
                    category=t.get("category"), page=t.get("page"),
                )
                for t in payload["transactions"]
            ],
        )
        result = _write(session, caller.tenant_id, write_input)
    return to_tool_dict(result)
