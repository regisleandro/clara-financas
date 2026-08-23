"""Abrir uma fatura e ver o que está dentro dela — porta de `agent/tools/read_batch.ts`.

Sem esta tool, corrigir um item é impossível: o `transaction_id` só existe
aqui. Devolve também o `checksum_report` PERSISTIDO — a divergência de ontem
continua recuperável hoje.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.category_labels import load_category_labels
from clara.db.models import Batch, Document, Transaction
from clara.ledger.categories import category_label
from clara.ledger.invoice_label import format_document_label
from clara.ledger.money import format_cents
from clara.tools.errors import ToolError, not_found
from clara.tools.invoice_focus import set_invoice_focus


@dataclass
class TransactionView:
    id: str
    date: str
    description: str
    merchant: str | None
    amount_cents: int
    amount_formatted: str
    kind: str
    category: str | None
    category_label: str
    confidence: str
    installment: dict[str, int] | None
    page: int | None
    suspect: bool


@dataclass
class BatchView:
    batch_id: str
    document_id: str
    document_kind: str
    document_label: str
    invoice_label: str
    issuer: str | None
    status: str
    editable: bool
    period_start: str | None
    period_end: str | None
    due_date: str | None
    declared_total_cents: int | None
    opening_balance_cents: int | None
    closing_balance_cents: int | None
    declared_subtotals: dict[str, Any] | None
    extracted_total_cents: int | None
    checksum: dict[str, Any]
    transaction_count: int
    returned: int
    transactions: list[TransactionView] = field(default_factory=list)
    statement_balance: dict[str, Any] | None = None


def read_batch(
    session: Session,
    tenant_id: str,
    session_id: str,
    batch_id: str,
    *,
    only_suspects: bool = False,
) -> BatchView | ToolError:
    row = session.execute(
        select(Batch, Document.issuer, Document.kind)
        .join(Document, Document.id == Batch.document_id)
        .where(Batch.tenant_id == tenant_id, Batch.id == batch_id)
    ).first()

    if row is None:
        return not_found(
            "lote_nao_encontrado", f"Nenhum documento financeiro com o id {batch_id}.",
            hint="Confira os batch_id do estado do razão, ou chame list_invoices para o histórico.",
        )

    batch, issuer, document_kind = row
    focused = set_invoice_focus(session, tenant_id, session_id, batch.id)
    if not focused:
        raise RuntimeError("A sessão não estava persistida para guardar o foco da fatura.")

    txn_rows = session.execute(
        select(Transaction)
        .where(Transaction.tenant_id == tenant_id, Transaction.batch_id == batch.id)
        .order_by(Transaction.date.asc(), Transaction.id.asc())
    ).scalars().all()

    report = batch.checksum_report or {}
    is_statement = report.get("kind") == "statement_balance"
    checksum_report = None if is_statement else (report or None)
    statement_balance = report if is_statement else None

    suspects = {
        item["transaction_id"] for item in (checksum_report or {}).get("suspect_items", [])
    }
    labels = load_category_labels(session, tenant_id)

    if checksum_report is None:
        checksum: dict[str, Any] = {"result": batch.checksum_result}
    else:
        difference = checksum_report.get("difference")
        checksum = {
            "result": checksum_report.get("result"),
            "likely_cause": checksum_report.get("likely_cause"),
            "localized_in": checksum_report.get("localized_in"),
            "declared_total_cents": checksum_report.get("declared_total"),
            "extracted_total_cents": checksum_report.get("extracted_total"),
            "difference_cents": difference,
            "difference_formatted": None if difference is None else format_cents(difference),
            "required_adjustment_cents": None if difference is None else -difference,
            "required_adjustment_formatted": (
                None if difference is None else format_cents(-difference)
            ),
            "suspect_items": checksum_report.get("suspect_items", []),
        }

    selected = [t for t in txn_rows if t.id in suspects] if only_suspects else txn_rows

    return BatchView(
        batch_id=batch.id, document_id=batch.document_id, document_kind=document_kind,
        document_label=format_document_label(
            issuer=issuer, due_date=batch.due_date, period_end=batch.period_end,
            document_kind=document_kind,
        ),
        invoice_label=format_document_label(
            issuer=issuer, due_date=batch.due_date, period_end=batch.period_end,
            document_kind=document_kind,
        ),
        issuer=issuer, status=batch.status, editable=batch.status == "proposed",
        period_start=batch.period_start, period_end=batch.period_end, due_date=batch.due_date,
        declared_total_cents=batch.declared_total, opening_balance_cents=batch.opening_balance,
        closing_balance_cents=batch.closing_balance, declared_subtotals=batch.declared_subtotals,
        extracted_total_cents=batch.extracted_total, checksum=checksum,
        statement_balance=statement_balance,
        transaction_count=len(txn_rows), returned=len(selected),
        transactions=[
            TransactionView(
                id=t.id, date=t.date, description=t.original_description, merchant=t.merchant,
                amount_cents=t.amount, amount_formatted=format_cents(t.amount), kind=t.kind,
                category=t.category, category_label=category_label(labels, t.category),
                confidence=t.extraction_confidence,
                installment=(
                    {"current": t.installment_current, "total": t.installment_total}
                    if t.installment_current is not None and t.installment_total is not None
                    else None
                ),
                page=t.page, suspect=t.id in suspects,
            )
            for t in selected
        ],
    )
