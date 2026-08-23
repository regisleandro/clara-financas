"""Prepara a proposta canônica de registro — porta de `prepare_batch_registration.ts`.

Chamada imediatamente antes de `commit_batch`: congela a revisão do
documento, a conferência e a contagem de lançamentos mostrados na aprovação.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from clara.db.models import Batch, Document, FinancialActionProposal, Transaction
from clara.ledger.invoice_label import format_document_label
from clara.ledger.money import format_cents
from clara.tools.errors import ToolError, not_found, refused

PROPOSAL_TTL = timedelta(minutes=30)


@dataclass
class PreparedRegistration:
    proposal_id: str
    batch_id: str
    entity_revision: datetime
    expires_at: datetime
    issuer: str | None
    document_kind: str
    invoice_label: str
    transaction_count: int
    checksum_result: str | None
    declared_total_cents: int | None
    extracted_total_cents: int | None
    extracted_total_formatted: str | None
    difference_cents: int | None


def prepare_batch_registration(
    session: Session, tenant_id: str, user_id: str, batch_id: str
) -> PreparedRegistration | ToolError:
    row = session.execute(
        select(Batch, Document.issuer, Document.kind)
        .join(Document, Document.id == Batch.document_id)
        .where(Batch.id == batch_id, Batch.tenant_id == tenant_id)
    ).first()

    if row is None:
        return not_found("lote_nao_encontrado", f"Nenhum documento com o id {batch_id}.")

    batch, issuer, document_kind = row
    if batch.status != "proposed":
        return refused("lote_ja_decidido", "Este documento já foi decidido.")

    transaction_count = session.execute(
        select(func.count(Transaction.id)).where(
            Transaction.batch_id == batch.id,
            Transaction.tenant_id == tenant_id,
            Transaction.status == "proposed",
        )
    ).scalar_one()

    report = batch.checksum_report or {}
    is_statement = report.get("kind") == "statement_balance"
    checksum = None if is_statement else report or None

    proposal_id = f"act_{uuid.uuid4().hex[:24]}"
    expires_at = datetime.now(UTC) + PROPOSAL_TTL
    invoice_label = format_document_label(
        issuer=issuer, due_date=batch.due_date, period_end=batch.period_end,
        document_kind=document_kind,
    )

    checksum_result = report.get("result") if report else None
    declared_total = checksum.get("declared_total") if checksum else None
    extracted_total = checksum.get("extracted_total") if checksum else None
    difference = checksum.get("difference") if checksum else None

    payload = {
        "transaction_count": transaction_count,
        "checksum_result": checksum_result,
        "declared_total_cents": declared_total,
        "extracted_total_cents": extracted_total,
        "difference_cents": difference,
        "issuer": issuer,
        "document_kind": document_kind,
        "invoice_label": invoice_label,
    }

    session.add(
        FinancialActionProposal(
            id=proposal_id, tenant_id=tenant_id, batch_id=batch.id,
            operation="register_invoice", entity_revision=batch.updated_at,
            payload=payload, prepared_by=f"human:{user_id}", expires_at=expires_at,
        )
    )
    session.flush()

    return PreparedRegistration(
        proposal_id=proposal_id, batch_id=batch.id, entity_revision=batch.updated_at,
        expires_at=expires_at, issuer=issuer, document_kind=document_kind,
        invoice_label=invoice_label, transaction_count=transaction_count,
        checksum_result=checksum_result, declared_total_cents=declared_total,
        extracted_total_cents=extracted_total,
        extracted_total_formatted=(
            None if extracted_total is None else format_cents(extracted_total)
        ),
        difference_cents=difference,
    )
