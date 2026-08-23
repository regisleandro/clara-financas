"""prepare_batch_registration() contra Postgres real."""

from __future__ import annotations

import uuid

from clara.db.models import Batch, Document
from clara.db.tenant_scope import for_tenant
from clara.tools.prepare_batch_registration import PreparedRegistration, prepare_batch_registration
from clara.tools.write_proposed_batch import (
    ProposedBatchWriteInput,
    ProposedBatchWriteResult,
    ProposedTransactionInput,
    write_proposed_batch,
)


def test_batch_not_found(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        result = prepare_batch_registration(session, tenant_id, "user_1", "batch_ghost")
    assert "error" in result  # type: ignore[operator]
    assert result["error"]["code"] == "lote_nao_encontrado"  # type: ignore[index]


def test_prepares_proposal_with_checksum_snapshot(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        doc_id = f"doc_{uuid.uuid4().hex}"
        session.add(Document(id=doc_id, tenant_id=tenant_id, kind="credit_card_invoice",
                              blob_key="k", filename="f.pdf", content_hash=uuid.uuid4().hex,
                              issuer="Nubank"))
        session.flush()
        proposed = write_proposed_batch(
            session, tenant_id,
            ProposedBatchWriteInput(
                document_id=doc_id, declared_total=1000,
                transactions=[
                    ProposedTransactionInput(
                        date="2026-06-10", original_description="Padaria",
                        amount=1000, extraction_confidence="alta",
                    )
                ],
            ),
        )
    assert isinstance(proposed, ProposedBatchWriteResult)

    with for_tenant(tenant_id) as session:
        prepared = prepare_batch_registration(session, tenant_id, "user_1", proposed.batch_id)

    assert isinstance(prepared, PreparedRegistration)
    assert prepared.batch_id == proposed.batch_id
    assert prepared.checksum_result == "match"
    assert prepared.transaction_count == 1
    assert prepared.declared_total_cents == 1000
    assert prepared.extracted_total_cents == 1000
    assert prepared.extracted_total_formatted == "R$ 10,00"


def test_already_decided_batch_refuses(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        doc_id = f"doc_{uuid.uuid4().hex}"
        batch_id = f"batch_{uuid.uuid4().hex}"
        session.add(Document(id=doc_id, tenant_id=tenant_id, kind="credit_card_invoice",
                              blob_key="k", filename="f.pdf", content_hash=uuid.uuid4().hex))
        session.flush()
        session.add(Batch(id=batch_id, tenant_id=tenant_id, document_id=doc_id, status="confirmed"))

    with for_tenant(tenant_id) as session:
        result = prepare_batch_registration(session, tenant_id, "user_1", batch_id)

    assert "error" in result  # type: ignore[operator]
    assert result["error"]["code"] == "lote_ja_decidido"  # type: ignore[index]
