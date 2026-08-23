"""Recuperação explícita para o histórico que não cabe no snapshot de turno.

Porta de `agent/tools/list_invoices.ts`. Devolve os DOIS totais de cada
fatura: `declared_total_cents` (o que o documento afirma, pode ser `null`)
e `extracted_total_cents` (a soma que a extração leu — mesma regra de
`counts_toward_declared_total`: pagamento não compõe, quita o ciclo anterior).
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from clara.db.invoice_order import latest_invoice_order, oldest_invoice_order
from clara.db.models import Batch, Document, Transaction
from clara.ledger.invoice_label import format_document_label
from clara.ledger.money import format_cents


@dataclass
class InvoiceRow:
    batch_id: str
    document_id: str
    issuer: str | None
    document_kind: str
    status: str
    period_start: str | None
    period_end: str | None
    due_date: str | None
    declared_total_cents: int | None
    checksum_result: str | None
    transaction_count: int
    extracted_total_cents: int
    document_label: str
    invoice_label: str
    declared_total_formatted: str | None
    extracted_total_formatted: str
    total_to_show: int


def list_invoices(
    session: Session, tenant_id: str, *, limit: int = 20, oldest_first: bool = False
) -> list[InvoiceRow]:
    txn_count = (
        select(func.count(Transaction.id))
        .where(Transaction.batch_id == Batch.id)
        .correlate(Batch)
        .scalar_subquery()
    )
    extracted_total = (
        select(func.coalesce(func.sum(Transaction.amount), 0))
        .where(Transaction.batch_id == Batch.id, Transaction.kind != "payment")
        .correlate(Batch)
        .scalar_subquery()
    )

    order = oldest_invoice_order() if oldest_first else latest_invoice_order()
    rows = session.execute(
        select(
            Batch.id.label("batch_id"), Batch.document_id, Document.issuer,
            Document.kind.label("document_kind"), Batch.status,
            Batch.period_start, Batch.period_end, Batch.due_date, Batch.declared_total,
            Batch.checksum_result, txn_count.label("transaction_count"),
            extracted_total.label("extracted_total_cents"),
        )
        .join(Document, Document.id == Batch.document_id)
        .where(Batch.status.in_(["proposed", "confirmed"]))
        .order_by(*order)
        .limit(limit)
    ).all()

    result: list[InvoiceRow] = []
    for r in rows:
        # `sum()` do PostgreSQL sobre bigint devolve numeric; o SQLAlchemy
        # mapeia para Decimal. Centavos são sempre int em todo o resto do
        # caminho (dinheiro é inteiro, nunca ponto flutuante nem Decimal
        # solto) — a conversão acontece aqui, na fronteira com o SQL agregado.
        extracted_total_cents = int(r.extracted_total_cents)
        label = format_document_label(
            issuer=r.issuer, due_date=r.due_date, period_end=r.period_end,
            document_kind=r.document_kind,
        )
        result.append(
            InvoiceRow(
                batch_id=r.batch_id, document_id=r.document_id, issuer=r.issuer,
                document_kind=r.document_kind, status=r.status, period_start=r.period_start,
                period_end=r.period_end, due_date=r.due_date,
                declared_total_cents=r.declared_total, checksum_result=r.checksum_result,
                transaction_count=r.transaction_count,
                extracted_total_cents=extracted_total_cents,
                document_label=label, invoice_label=label,
                declared_total_formatted=(
                    None if r.declared_total is None else format_cents(r.declared_total)
                ),
                extracted_total_formatted=format_cents(extracted_total_cents),
                total_to_show=(
                    r.declared_total if r.declared_total is not None else extracted_total_cents
                ),
            )
        )
    return result
