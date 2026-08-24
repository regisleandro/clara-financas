"""Resolução de divergência de fatura CONFIRMADA — porta dos casos reais de
`prepare_invoice_resolution.ts` / `apply_invoice_resolution.ts`."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from clara.db.models import Batch, Document, Transaction
from clara.db.tenant_scope import for_tenant
from clara.tools.apply_invoice_resolution import ResolutionReceipt, apply_invoice_resolution
from clara.tools.prepare_invoice_resolution import PreparedResolution, prepare_invoice_resolution
from clara.tools.recompute_batch_checksum import recompute_batch_checksum


def _seed_confirmed_mismatch(
    session,  # noqa: ANN001
    tenant: str,
    *,
    amount: int = 10000,
    declared_total: int = 9000,
) -> tuple[str, str]:
    doc_id = f"doc_{uuid.uuid4().hex}"
    batch_id = f"batch_{uuid.uuid4().hex}"
    txn_id = f"txn_{uuid.uuid4().hex}"
    session.add(
        Document(
            id=doc_id, tenant_id=tenant, kind="credit_card_invoice",
            blob_key="k", filename="f.pdf", content_hash=uuid.uuid4().hex,
        )
    )
    session.flush()
    session.add(
        Batch(
            id=batch_id, tenant_id=tenant, document_id=doc_id, status="confirmed",
            declared_total=declared_total,
        )
    )
    session.flush()
    session.add(
        Transaction(
            id=txn_id, tenant_id=tenant, batch_id=batch_id, status="confirmed",
            date="2026-06-01", original_description="Compra crua", merchant="Loja X",
            amount=amount, kind="purchase", extraction_confidence="alta",
            source_document_id=doc_id,
        )
    )
    session.flush()
    batch = session.get(Batch, batch_id)
    assert batch is not None
    recompute_batch_checksum(session, tenant, batch)
    session.flush()
    return batch_id, txn_id


def test_prepare_then_apply_closes_the_difference(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        batch_id, txn_id = _seed_confirmed_mismatch(
            session, tenant_id, amount=10000, declared_total=9000
        )

    with for_tenant(tenant_id) as session:
        prepared = prepare_invoice_resolution(
            session, tenant_id, "user_1", batch_id=batch_id, reason="cobrança a mais",
        )
    assert isinstance(prepared, PreparedResolution)
    assert prepared.difference_before_cents == 1000
    assert prepared.adjustment_cents == -1000

    with for_tenant(tenant_id) as session:
        applied = apply_invoice_resolution(
            session, tenant_id, "user_1", proposal_id=prepared.proposal_id,
        )
    assert isinstance(applied, ResolutionReceipt)
    assert applied.adjustment_cents == -1000
    assert applied.difference_after_cents == 0

    with for_tenant(tenant_id) as session:
        batch = session.get(Batch, batch_id)
        assert batch is not None
        assert batch.checksum_result == "match"

        original = session.get(Transaction, txn_id)
        assert original is not None
        assert original.amount == 10000  # a linha original nunca muda

        adjustment = session.get(Transaction, applied.mutation_id)
        assert adjustment is not None
        assert adjustment.amount == -1000
        assert adjustment.status == "adjustment"
        assert adjustment.action_id == prepared.proposal_id


def test_apply_is_idempotent_on_replay(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        batch_id, _ = _seed_confirmed_mismatch(session, tenant_id)

    with for_tenant(tenant_id) as session:
        prepared = prepare_invoice_resolution(
            session, tenant_id, "user_1", batch_id=batch_id, reason="cobrança a mais",
        )
    assert isinstance(prepared, PreparedResolution)

    with for_tenant(tenant_id) as session:
        first = apply_invoice_resolution(
            session, tenant_id, "user_1", proposal_id=prepared.proposal_id,
        )
    assert isinstance(first, ResolutionReceipt)

    with for_tenant(tenant_id) as session:
        second = apply_invoice_resolution(
            session, tenant_id, "user_1", proposal_id=prepared.proposal_id,
        )
    assert isinstance(second, dict)
    assert second["already_applied"] is True
    assert second["mutation_id"] == first.mutation_id

    with for_tenant(tenant_id) as session:
        adjustments = session.execute(
            select(Transaction).where(
                Transaction.tenant_id == tenant_id, Transaction.status == "adjustment"
            )
        ).scalars().all()
    assert len(adjustments) == 1


def test_prepare_refuses_a_batch_without_mismatch(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        batch_id, _ = _seed_confirmed_mismatch(
            session, tenant_id, amount=10000, declared_total=10000
        )

    with for_tenant(tenant_id) as session:
        result = prepare_invoice_resolution(
            session, tenant_id, "user_1", batch_id=batch_id, reason="tentativa",
        )
    assert isinstance(result, dict)
    assert result["error"]["code"] == "fatura_sem_divergencia"


def test_prepare_refuses_a_draft_batch(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        doc_id = f"doc_{uuid.uuid4().hex}"
        batch_id = f"batch_{uuid.uuid4().hex}"
        session.add(
            Document(
                id=doc_id, tenant_id=tenant_id, kind="credit_card_invoice",
                blob_key="k", filename="f.pdf", content_hash=uuid.uuid4().hex,
            )
        )
        session.flush()
        session.add(Batch(id=batch_id, tenant_id=tenant_id, document_id=doc_id, status="proposed"))
        session.flush()

    with for_tenant(tenant_id) as session:
        result = prepare_invoice_resolution(
            session, tenant_id, "user_1", batch_id=batch_id, reason="tentativa",
        )
    assert isinstance(result, dict)
    assert result["error"]["code"] == "operacao_nao_permitida"


def test_prepare_ignores_a_target_from_another_batch_but_still_prepares(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        batch_id, _ = _seed_confirmed_mismatch(session, tenant_id)

    with for_tenant(tenant_id) as session:
        prepared = prepare_invoice_resolution(
            session, tenant_id, "user_1", batch_id=batch_id, reason="cobrança a mais",
            target_transaction_id="txn_de_outra_fatura",
        )
    assert isinstance(prepared, PreparedResolution)
    assert prepared.target_ignored is not None
    assert prepared.target_ignored.requested_id == "txn_de_outra_fatura"
    assert prepared.target_transaction_id is None


def test_apply_refuses_when_batch_changed_since_prepare(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        batch_id, txn_id = _seed_confirmed_mismatch(session, tenant_id)

    with for_tenant(tenant_id) as session:
        prepared = prepare_invoice_resolution(
            session, tenant_id, "user_1", batch_id=batch_id, reason="cobrança a mais",
        )
    assert isinstance(prepared, PreparedResolution)

    # a fatura muda depois da proposta: o total declarado é corrigido, o que
    # bate `Batch.updated_at` (onupdate) e muda a conferência de verdade
    with for_tenant(tenant_id) as session:
        batch = session.get(Batch, batch_id)
        assert batch is not None
        batch.declared_total = 8000
        recompute_batch_checksum(session, tenant_id, batch)

    with for_tenant(tenant_id) as session:
        result = apply_invoice_resolution(
            session, tenant_id, "user_1", proposal_id=prepared.proposal_id,
        )
    assert isinstance(result, dict)
    assert result["error"]["code"] == "proposta_desatualizada"
