"""O gate — commit_batch() contra Postgres real.

Cobre FR-009 a FR-013: um lote proposto não é gasto confirmado; commit_batch
é o único caminho de escrita; a revisão do lote e o estado são revalidados na
execução, não na proposta; e a operação é idempotente.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from clara.db.models import Batch, Document, FinancialActionProposal, Transaction
from clara.db.tenant_scope import for_tenant
from clara.tools.commit_batch import CommitReceipt, commit_batch
from clara.tools.prepare_batch_registration import PreparedRegistration, prepare_batch_registration
from clara.tools.write_proposed_batch import (
    ProposedBatchWriteInput,
    ProposedBatchWriteResult,
    ProposedTransactionInput,
    write_proposed_batch,
)


def _propose(session, tenant_id: str) -> str:  # noqa: ANN001
    doc_id = f"doc_{uuid.uuid4().hex}"
    session.add(Document(id=doc_id, tenant_id=tenant_id, kind="credit_card_invoice",
                          blob_key="k", filename="f.pdf", content_hash=uuid.uuid4().hex))
    session.flush()
    result = write_proposed_batch(
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
    assert isinstance(result, ProposedBatchWriteResult)
    return result.batch_id


def test_batch_not_found(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        result = commit_batch(session, tenant_id, "user_1", batch_id="batch_ghost")
    assert "error" in result  # type: ignore[operator]
    assert result["error"]["code"] == "lote_nao_encontrado"  # type: ignore[index]


def test_requires_batch_id_or_proposal_id(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        result = commit_batch(session, tenant_id, "user_1")
    assert "error" in result  # type: ignore[operator]


def test_nothing_is_written_before_commit(tenant_id: str) -> None:
    """FR-009: um lote `proposed` não conta como gasto confirmado."""
    with for_tenant(tenant_id) as session:
        batch_id = _propose(session, tenant_id)

    with for_tenant(tenant_id) as session:
        batch = session.get(Batch, batch_id)
        assert batch is not None
        assert batch.status == "proposed"
        txn = session.execute(
            select(Transaction).where(Transaction.batch_id == batch_id)
        ).scalar_one()
        assert txn.status == "proposed"


def test_direct_commit_confirms_batch_and_transactions(tenant_id: str) -> None:
    """FR-010: commit_batch é o único caminho de escrita no razão."""
    with for_tenant(tenant_id) as session:
        batch_id = _propose(session, tenant_id)

    with for_tenant(tenant_id) as session:
        receipt = commit_batch(session, tenant_id, "user_1", batch_id=batch_id)

    assert isinstance(receipt, CommitReceipt)
    assert receipt.status == "confirmed"
    assert receipt.confirmed_transactions == 1
    assert receipt.already_confirmed is False

    with for_tenant(tenant_id) as session:
        batch = session.get(Batch, batch_id)
        assert batch is not None
        assert batch.status == "confirmed"
        assert batch.approved_by == "human:user_1"
        txn = session.execute(
            select(Transaction).where(Transaction.batch_id == batch_id)
        ).scalar_one()
        assert txn.status == "confirmed"


def test_commit_is_idempotent(tenant_id: str) -> None:
    """FR-013: lote já confirmado devolve o recibo em vez de confirmar de novo."""
    with for_tenant(tenant_id) as session:
        batch_id = _propose(session, tenant_id)

    with for_tenant(tenant_id) as session:
        first = commit_batch(session, tenant_id, "user_1", batch_id=batch_id)
    assert isinstance(first, CommitReceipt)

    with for_tenant(tenant_id) as session:
        second = commit_batch(session, tenant_id, "user_1", batch_id=batch_id)

    assert isinstance(second, CommitReceipt)
    assert second.already_confirmed is True
    assert second.confirmed_transactions == 0


def test_rejected_batch_cannot_be_committed(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        doc_id = f"doc_{uuid.uuid4().hex}"
        batch_id = f"batch_{uuid.uuid4().hex}"
        session.add(Document(id=doc_id, tenant_id=tenant_id, kind="credit_card_invoice",
                              blob_key="k", filename="f.pdf", content_hash=uuid.uuid4().hex))
        session.flush()
        session.add(Batch(id=batch_id, tenant_id=tenant_id, document_id=doc_id, status="rejected"))

    with for_tenant(tenant_id) as session:
        result = commit_batch(session, tenant_id, "user_1", batch_id=batch_id)
    assert "error" in result  # type: ignore[operator]
    assert result["error"]["code"] == "lote_ja_decidido"  # type: ignore[index]


def test_via_proposal_revalidates_revision_after_pause(tenant_id: str) -> None:
    """FR-012: a fatura pode mudar enquanto o turno está pausado esperando
    aprovação — a revisão é revalidada na execução, não na proposta."""
    with for_tenant(tenant_id) as session:
        batch_id = _propose(session, tenant_id)
        prepared = prepare_batch_registration(session, tenant_id, "user_1", batch_id)
    assert isinstance(prepared, PreparedRegistration)

    # A "política mudou enquanto o turno esperava": alguém editou o rascunho.
    with for_tenant(tenant_id) as session:
        batch = session.get(Batch, batch_id)
        assert batch is not None
        batch.declared_total = 999999
        batch.updated_at = datetime.now(UTC) + timedelta(minutes=1)

    with for_tenant(tenant_id) as session:
        result = commit_batch(session, tenant_id, "user_1", proposal_id=prepared.proposal_id)

    assert "error" in result  # type: ignore[operator]
    assert result["error"]["code"] == "proposta_desatualizada"  # type: ignore[index]

    # nada foi gravado: o lote continua proposed
    with for_tenant(tenant_id) as session:
        batch = session.get(Batch, batch_id)
        assert batch is not None
        assert batch.status == "proposed"


def test_via_proposal_commits_and_marks_proposal_applied(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        batch_id = _propose(session, tenant_id)
        prepared = prepare_batch_registration(session, tenant_id, "user_1", batch_id)
    assert isinstance(prepared, PreparedRegistration)

    with for_tenant(tenant_id) as session:
        receipt = commit_batch(session, tenant_id, "user_1", proposal_id=prepared.proposal_id)

    assert isinstance(receipt, CommitReceipt)
    assert receipt.status == "confirmed"

    with for_tenant(tenant_id) as session:
        proposal = session.get(FinancialActionProposal, prepared.proposal_id)
        assert proposal is not None
        assert proposal.status == "applied"
        assert proposal.receipt is not None
        assert proposal.receipt["status"] == "confirmed"


def test_expired_proposal_is_refused(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        batch_id = _propose(session, tenant_id)
        prepared = prepare_batch_registration(session, tenant_id, "user_1", batch_id)
    assert isinstance(prepared, PreparedRegistration)

    with for_tenant(tenant_id) as session:
        proposal = session.get(FinancialActionProposal, prepared.proposal_id)
        assert proposal is not None
        proposal.expires_at = datetime.now(UTC) - timedelta(minutes=1)

    with for_tenant(tenant_id) as session:
        result = commit_batch(session, tenant_id, "user_1", proposal_id=prepared.proposal_id)

    assert "error" in result  # type: ignore[operator]
    assert result["error"]["code"] == "proposta_expirada"  # type: ignore[index]


def test_replaying_applied_proposal_returns_existing_receipt(tenant_id: str) -> None:
    """Um replay do passo durável não pode confirmar duas vezes."""
    with for_tenant(tenant_id) as session:
        batch_id = _propose(session, tenant_id)
        prepared = prepare_batch_registration(session, tenant_id, "user_1", batch_id)
    assert isinstance(prepared, PreparedRegistration)

    with for_tenant(tenant_id) as session:
        commit_batch(session, tenant_id, "user_1", proposal_id=prepared.proposal_id)

    with for_tenant(tenant_id) as session:
        replay = commit_batch(session, tenant_id, "user_1", proposal_id=prepared.proposal_id)

    assert isinstance(replay, dict)
    assert replay.get("already_confirmed") is True
