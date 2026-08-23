"""Faz uma fatura virar o sujeito explícito da conversa — porta de
`agent/lib/invoice-focus.ts`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from clara.db.invoice_order import latest_invoice_order
from clara.db.models import AgentSession, Batch, Document
from clara.ledger.invoice_label import format_document_label

InvoiceReference = Literal["active", "latest", "next_with_divergence"]


@dataclass
class InvoiceFocus:
    batch_id: str
    document_id: str
    issuer: str | None
    document_kind: str
    invoice_label: str
    status: str
    period_start: str | None
    period_end: str | None
    due_date: str | None
    checksum_result: str | None


def set_invoice_focus(session: Session, tenant_id: str, session_id: str, batch_id: str) -> bool:
    """A linha de sessão já foi criada e teve a posse validada pela ACL. Zero
    linhas atualizadas é erro: fingir foco guardado sem sessão persistida
    devolveria a ambiguidade que esta camada existe para eliminar."""
    result = session.execute(
        update(AgentSession)
        .where(AgentSession.tenant_id == tenant_id, AgentSession.session_id == session_id)
        .values(active_batch_id=batch_id, focus_updated_at=datetime.now(UTC))
        .returning(AgentSession.session_id)
    ).scalar_one_or_none()
    return result is not None


def resolve_invoice_focus(
    session: Session,
    tenant_id: str,
    session_id: str,
    reference: InvoiceReference,
    *,
    skip_active: bool = False,
) -> InvoiceFocus | None:
    agent_session = session.get(AgentSession, session_id)
    if agent_session is None or agent_session.tenant_id != tenant_id:
        return None

    rows = session.execute(
        select(
            Batch.id.label("batch_id"), Batch.document_id, Document.issuer,
            Document.kind.label("document_kind"), Batch.status,
            Batch.period_start, Batch.period_end, Batch.due_date, Batch.checksum_result,
        )
        .join(Document, Document.id == Batch.document_id)
        .where(Batch.status.in_(["proposed", "confirmed"]))
        .order_by(*latest_invoice_order())
    ).all()

    selected = None
    if reference == "active":
        selected = next((r for r in rows if r.batch_id == agent_session.active_batch_id), None)
    elif reference == "latest":
        # "A última FATURA" é uma fatura: prioriza credit_card_invoice; cai
        # para qualquer documento se o razão só tiver extratos/notas.
        selected = next((r for r in rows if r.document_kind == "credit_card_invoice"), None)
        if selected is None and rows:
            selected = rows[0]
    else:
        active_index = next(
            (i for i, r in enumerate(rows) if r.batch_id == agent_session.active_batch_id), -1
        )
        starts_at = 0 if active_index < 0 else (active_index + 1 if skip_active else active_index)
        selected = next((r for r in rows[starts_at:] if r.checksum_result == "mismatch"), None)

    if selected is None:
        return None

    session.execute(
        update(AgentSession)
        .where(AgentSession.session_id == session_id)
        .values(active_batch_id=selected.batch_id, focus_updated_at=datetime.now(UTC))
    )

    return InvoiceFocus(
        batch_id=selected.batch_id, document_id=selected.document_id, issuer=selected.issuer,
        document_kind=selected.document_kind,
        invoice_label=format_document_label(
            issuer=selected.issuer, due_date=selected.due_date, period_end=selected.period_end,
            document_kind=selected.document_kind,
        ),
        status=selected.status, period_start=selected.period_start,
        period_end=selected.period_end, due_date=selected.due_date,
        checksum_result=selected.checksum_result,
    )
