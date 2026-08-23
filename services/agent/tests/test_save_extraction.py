"""save_extraction() contra Postgres real — a passagem por referência do extrator."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from clara.db.models import Document, ExtractionStaging
from clara.db.tenant_scope import for_tenant
from clara.tools.extractor.save_extraction import save_extraction
from clara.views.agent_contracts import ExtractedTransaction, ExtractionReceipt, ExtractionResult


def _result(document_id: str, **overrides: object) -> ExtractionResult:
    defaults: dict[str, object] = dict(
        document_id=document_id, issuer="Nubank", period_start="2026-06-01",
        period_end="2026-06-30", due_date="2026-07-07", declared_total=1000,
        declared_subtotals=None,
        transactions=[
            ExtractedTransaction(
                date="2026-06-10", original_description="Padaria", merchant=None,
                amount=1000, kind="purchase", installment=None, category=None,
                extraction_confidence="alta", page=1,
            )
        ],
    )
    defaults.update(overrides)
    return ExtractionResult(**defaults)  # type: ignore[arg-type]


def test_document_not_found(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        result = save_extraction(session, tenant_id, _result("doc_ghost"))
    assert "error" in result  # type: ignore[operator]
    assert result["error"]["code"] == "documento_nao_encontrado"  # type: ignore[index]


def test_persists_and_returns_receipt(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        doc_id = f"doc_{uuid.uuid4().hex}"
        session.add(Document(id=doc_id, tenant_id=tenant_id, kind="unknown",
                              blob_key="k", filename="f.pdf", content_hash=uuid.uuid4().hex))
        session.flush()
        receipt = save_extraction(session, tenant_id, _result(doc_id))

    assert isinstance(receipt, ExtractionReceipt)
    assert receipt.transaction_count == 1
    assert receipt.next_action == "propose_batch_from_extraction"

    with for_tenant(tenant_id) as session:
        staging = session.execute(
            select(ExtractionStaging).where(ExtractionStaging.document_id == doc_id)
        ).scalar_one()
        assert staging.payload["transactions"][0]["amount"] == 1000
        document = session.get(Document, doc_id)
        assert document is not None
        assert document.kind == "credit_card_invoice"  # default do ExtractionResult


def test_reextracting_replaces_previous_staging(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        doc_id = f"doc_{uuid.uuid4().hex}"
        session.add(Document(id=doc_id, tenant_id=tenant_id, kind="unknown",
                              blob_key="k", filename="f.pdf", content_hash=uuid.uuid4().hex))
        session.flush()
        first = save_extraction(session, tenant_id, _result(doc_id))
    assert isinstance(first, ExtractionReceipt)

    with for_tenant(tenant_id) as session:
        second = save_extraction(session, tenant_id, _result(doc_id, declared_total=2000))
    assert isinstance(second, ExtractionReceipt)

    with for_tenant(tenant_id) as session:
        rows = session.execute(
            select(ExtractionStaging).where(ExtractionStaging.document_id == doc_id)
        ).scalars().all()
        assert len(rows) == 1
        assert rows[0].id == second.extraction_id
