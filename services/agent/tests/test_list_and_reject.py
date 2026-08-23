"""list_invoices, list_documents e reject_batch contra Postgres real."""

from __future__ import annotations

import uuid

from clara.db.models import Batch, Document
from clara.db.tenant_scope import for_tenant
from clara.tools.list_documents import ListDocumentsResult, list_documents
from clara.tools.list_invoices import InvoiceRow, list_invoices
from clara.tools.reject_batch import RejectReceipt, reject_batch
from clara.tools.write_proposed_batch import (
    ProposedBatchWriteInput,
    ProposedBatchWriteResult,
    ProposedTransactionInput,
    write_proposed_batch,
)


def _propose(session, tenant: str, *, issuer: str = "Nubank") -> tuple[str, str]:  # noqa: ANN001
    doc_id = f"doc_{uuid.uuid4().hex}"
    session.add(Document(id=doc_id, tenant_id=tenant, kind="credit_card_invoice",
                          blob_key="k", filename="f.pdf", content_hash=uuid.uuid4().hex,
                          issuer=issuer))
    session.flush()
    result = write_proposed_batch(
        session, tenant,
        ProposedBatchWriteInput(
            document_id=doc_id, declared_total=1000, due_date="2026-07-07",
            transactions=[
                ProposedTransactionInput(date="2026-06-10", original_description="Padaria",
                                          amount=1000, extraction_confidence="alta")
            ],
        ),
    )
    assert isinstance(result, ProposedBatchWriteResult)
    return doc_id, result.batch_id


def test_list_invoices_returns_both_totals(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _propose(session, tenant_id)

    with for_tenant(tenant_id) as session:
        rows = list_invoices(session, tenant_id)

    assert len(rows) == 1
    assert isinstance(rows[0], InvoiceRow)
    assert rows[0].declared_total_cents == 1000
    assert rows[0].extracted_total_cents == 1000
    assert rows[0].total_to_show == 1000
    assert "Nubank" in rows[0].invoice_label


def test_list_documents_shows_orphans_without_batch(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        orphan_id = f"doc_{uuid.uuid4().hex}"
        session.add(Document(id=orphan_id, tenant_id=tenant_id, kind="unknown",
                              blob_key="k", filename="f.pdf", content_hash=uuid.uuid4().hex))
        _propose(session, tenant_id)

    with for_tenant(tenant_id) as session:
        result = list_documents(session, tenant_id)

    assert isinstance(result, ListDocumentsResult)
    assert result.count == 2
    orphan_row = next(d for d in result.documents if d.document_id == orphan_id)
    assert orphan_row.batch is None
    assert "extrator" in orphan_row.next


def test_list_documents_without_batch_filter(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        orphan_id = f"doc_{uuid.uuid4().hex}"
        session.add(Document(id=orphan_id, tenant_id=tenant_id, kind="unknown",
                              blob_key="k", filename="f.pdf", content_hash=uuid.uuid4().hex))
        _propose(session, tenant_id)

    with for_tenant(tenant_id) as session:
        result = list_documents(session, tenant_id, without_batch=True)

    assert result.count == 1
    assert result.documents[0].document_id == orphan_id


def test_reject_batch_discards_draft_and_marks_rejected(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _, batch_id = _propose(session, tenant_id)
        receipt = reject_batch(session, tenant_id, "user_1", batch_id, "duplicada")

    assert isinstance(receipt, RejectReceipt)
    assert receipt.status == "rejected"
    assert receipt.discarded_transactions == 1

    with for_tenant(tenant_id) as session:
        batch = session.get(Batch, batch_id)
        assert batch is not None
        assert batch.status == "rejected"


def test_reject_batch_is_idempotent(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _, batch_id = _propose(session, tenant_id)
        reject_batch(session, tenant_id, "user_1", batch_id, "duplicada")

    with for_tenant(tenant_id) as session:
        second = reject_batch(session, tenant_id, "user_1", batch_id, "de novo")

    assert isinstance(second, RejectReceipt)
    assert second.already_rejected is True


def test_confirmed_batch_cannot_be_rejected(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _, batch_id = _propose(session, tenant_id)
        batch = session.get(Batch, batch_id)
        assert batch is not None
        batch.status = "confirmed"

    with for_tenant(tenant_id) as session:
        result = reject_batch(session, tenant_id, "user_1", batch_id, "engano")

    assert "error" in result  # type: ignore[operator]
    assert result["error"]["code"] == "lote_ja_registrado"  # type: ignore[index]
