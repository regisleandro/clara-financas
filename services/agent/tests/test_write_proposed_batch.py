"""write_proposed_batch() contra Postgres real — o coração de US1.

Cobre: documento inexistente, feliz caminho com checksum, idempotência por
documento, proteção de rascunho editado, documento já registrado, categoria
inventada descartada (nunca gravada), e suspeita de dupla contagem.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from clara.db.models import Batch, Concept, Document, Transaction
from clara.db.tenant_scope import for_tenant
from clara.tools.write_proposed_batch import (
    ProposedBatchWriteInput,
    ProposedBatchWriteResult,
    ProposedTransactionInput,
    write_proposed_batch,
)


def _make_document(session, tenant: str, **overrides: object) -> str:  # noqa: ANN001
    doc_id = f"doc_{uuid.uuid4().hex}"
    defaults: dict[str, object] = dict(
        id=doc_id, tenant_id=tenant, kind="credit_card_invoice",
        blob_key="k", filename="f.pdf", content_hash=uuid.uuid4().hex,
    )
    defaults.update(overrides)
    session.add(Document(**defaults))  # type: ignore[arg-type]
    session.flush()
    return doc_id


def test_document_not_found(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        result = write_proposed_batch(
            session, tenant_id,
            ProposedBatchWriteInput(document_id="doc_ghost", transactions=[]),
        )
    assert "error" in result  # type: ignore[operator]
    assert result["error"]["code"] == "documento_nao_encontrado"  # type: ignore[index]


def test_happy_path_matches_checksum(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        doc_id = _make_document(session, tenant_id, issuer="Nubank")
        result = write_proposed_batch(
            session, tenant_id,
            ProposedBatchWriteInput(
                document_id=doc_id,
                declared_total=2500,
                transactions=[
                    ProposedTransactionInput(
                        date="2026-06-10", original_description="Padaria",
                        amount=1000, extraction_confidence="alta",
                    ),
                    ProposedTransactionInput(
                        date="2026-06-11", original_description="Mercado",
                        amount=1500, extraction_confidence="alta",
                    ),
                ],
            ),
        )

    assert isinstance(result, ProposedBatchWriteResult)
    assert result.checksum.result == "match"
    assert result.transaction_count == 2
    assert result.issuer == "Nubank"

    with for_tenant(tenant_id) as session:
        batch = session.get(Batch, result.batch_id)
        assert batch is not None
        assert batch.status == "proposed"
        txns = session.execute(
            select(Transaction).where(Transaction.batch_id == result.batch_id)
        ).scalars().all()
        assert len(txns) == 2
        assert all(t.merchant_key is not None for t in txns)


def test_reproposing_same_document_is_idempotent(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        doc_id = _make_document(session, tenant_id)
        first = write_proposed_batch(
            session, tenant_id,
            ProposedBatchWriteInput(
                document_id=doc_id,
                transactions=[
                    ProposedTransactionInput(
                        date="2026-06-10", original_description="Padaria",
                        amount=1000, extraction_confidence="alta",
                    )
                ],
            ),
        )
    assert isinstance(first, ProposedBatchWriteResult)

    with for_tenant(tenant_id) as session:
        second = write_proposed_batch(
            session, tenant_id,
            ProposedBatchWriteInput(
                document_id=doc_id,
                transactions=[
                    ProposedTransactionInput(
                        date="2026-06-10", original_description="Padaria",
                        amount=2000, extraction_confidence="alta",
                    )
                ],
            ),
        )
    assert isinstance(second, ProposedBatchWriteResult)
    assert second.batch_id != first.batch_id

    with for_tenant(tenant_id) as session:
        # o lote antigo foi removido — só um rascunho por documento
        assert session.get(Batch, first.batch_id) is None
        remaining_batches = session.execute(
            select(Batch).where(Batch.document_id == doc_id)
        ).scalars().all()
        assert len(remaining_batches) == 1


def test_edited_draft_is_protected(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        doc_id = _make_document(session, tenant_id)
        first = write_proposed_batch(
            session, tenant_id,
            ProposedBatchWriteInput(
                document_id=doc_id,
                transactions=[
                    ProposedTransactionInput(
                        date="2026-06-10", original_description="Padaria",
                        amount=1000, extraction_confidence="alta",
                    )
                ],
            ),
        )
    assert isinstance(first, ProposedBatchWriteResult)

    # simula edit_proposed_batch: updated_at > created_at
    with for_tenant(tenant_id) as session:
        batch = session.get(Batch, first.batch_id)
        assert batch is not None
        batch.created_at = datetime.now(UTC) - timedelta(minutes=5)
        batch.updated_at = datetime.now(UTC)

    with for_tenant(tenant_id) as session:
        blocked = write_proposed_batch(
            session, tenant_id,
            ProposedBatchWriteInput(
                document_id=doc_id,
                transactions=[
                    ProposedTransactionInput(
                        date="2026-06-10", original_description="Padaria",
                        amount=2000, extraction_confidence="alta",
                    )
                ],
            ),
        )
    assert "error" in blocked  # type: ignore[operator]
    assert blocked["error"]["code"] == "rascunho_editado"  # type: ignore[index]

    with for_tenant(tenant_id) as session:
        overwritten = write_proposed_batch(
            session, tenant_id,
            ProposedBatchWriteInput(
                document_id=doc_id, overwrite_edited_draft=True,
                transactions=[
                    ProposedTransactionInput(
                        date="2026-06-10", original_description="Padaria",
                        amount=2000, extraction_confidence="alta",
                    )
                ],
            ),
        )
    assert isinstance(overwritten, ProposedBatchWriteResult)


def test_already_confirmed_document_refuses(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        doc_id = _make_document(session, tenant_id)
        batch_id = f"batch_{uuid.uuid4().hex}"
        session.add(Batch(id=batch_id, tenant_id=tenant_id, document_id=doc_id, status="confirmed"))

    with for_tenant(tenant_id) as session:
        result = write_proposed_batch(
            session, tenant_id,
            ProposedBatchWriteInput(
                document_id=doc_id,
                transactions=[
                    ProposedTransactionInput(
                        date="2026-06-10", original_description="Padaria",
                        amount=1000, extraction_confidence="alta",
                    )
                ],
            ),
        )
    assert "error" in result  # type: ignore[operator]
    assert result["error"]["code"] == "documento_ja_registrado"  # type: ignore[index]
    assert result["error"]["retryable"] is False  # type: ignore[index]


def test_invented_category_is_dropped_not_forced(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        doc_id = _make_document(session, tenant_id)
        session.add(Concept(
            id=f"concept_{uuid.uuid4().hex}", tenant_id=tenant_id, bundle="constitution",
            concept_id="categories/groceries", type="Category",
            frontmatter={"type": "Category"}, body="",
        ))

    with for_tenant(tenant_id) as session:
        result = write_proposed_batch(
            session, tenant_id,
            ProposedBatchWriteInput(
                document_id=doc_id,
                transactions=[
                    ProposedTransactionInput(
                        date="2026-06-10", original_description="Padaria",
                        amount=1000, extraction_confidence="alta", category="services",
                    )
                ],
            ),
        )

    assert isinstance(result, ProposedBatchWriteResult)
    assert result.dropped_categories is not None
    assert result.dropped_categories.categories == ["services"]

    with for_tenant(tenant_id) as session:
        txn = session.execute(
            select(Transaction).where(Transaction.batch_id == result.batch_id)
        ).scalar_one()
        assert txn.category is None


def test_duplicate_suspect_against_confirmed_transaction(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        doc_a = _make_document(session, tenant_id)
        batch_a = f"batch_{uuid.uuid4().hex}"
        session.add(Batch(id=batch_a, tenant_id=tenant_id, document_id=doc_a, status="confirmed"))
        session.add(Transaction(
            id=f"txn_{uuid.uuid4().hex}", tenant_id=tenant_id, batch_id=batch_a, status="confirmed",
            date="2026-06-10", original_description="Padaria Central",
            merchant="Padaria Central", merchant_key="padaria central",
            amount=1000, kind="purchase", extraction_confidence="alta",
            source_document_id=doc_a,
        ))

    with for_tenant(tenant_id) as session:
        doc_b = _make_document(session, tenant_id)
        result = write_proposed_batch(
            session, tenant_id,
            ProposedBatchWriteInput(
                document_id=doc_b,
                transactions=[
                    ProposedTransactionInput(
                        date="2026-06-10", original_description="Padaria Central",
                        merchant="Padaria Central", amount=1000, extraction_confidence="alta",
                    )
                ],
            ),
        )

    assert isinstance(result, ProposedBatchWriteResult)
    assert len(result.duplicate_suspects) == 1
    assert result.duplicate_suspects[0].existing_transaction_id is not None
