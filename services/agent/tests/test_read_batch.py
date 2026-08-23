"""read_batch() contra Postgres real — o que abre o caminho de correção."""

from __future__ import annotations

import uuid

from clara.db.models import AgentSession, Document
from clara.db.tenant_scope import for_tenant
from clara.tools.read_batch import BatchView, read_batch
from clara.tools.write_proposed_batch import (
    ProposedBatchWriteInput,
    ProposedBatchWriteResult,
    ProposedTransactionInput,
    write_proposed_batch,
)


def _seed(session, tenant: str, declared_total: int = 2500) -> str:  # noqa: ANN001
    doc_id = f"doc_{uuid.uuid4().hex}"
    session.add(Document(id=doc_id, tenant_id=tenant, kind="credit_card_invoice",
                          blob_key="k", filename="f.pdf", content_hash=uuid.uuid4().hex))
    session.flush()
    result = write_proposed_batch(
        session, tenant,
        ProposedBatchWriteInput(
            document_id=doc_id, declared_total=declared_total,
            transactions=[
                ProposedTransactionInput(date="2026-06-10", original_description="Padaria",
                                          amount=1000, extraction_confidence="alta"),
                ProposedTransactionInput(date="2026-06-11", original_description="Mercado",
                                          amount=1500, extraction_confidence="baixa"),
            ],
        ),
    )
    assert isinstance(result, ProposedBatchWriteResult)
    return result.batch_id


def test_batch_not_found(tenant_id: str) -> None:
    sess_id = f"sess_{uuid.uuid4().hex}"
    with for_tenant(tenant_id) as session:
        session.add(AgentSession(session_id=sess_id, tenant_id=tenant_id, user_id="user_1"))
        result = read_batch(session, tenant_id, sess_id, "batch_ghost")
    assert "error" in result  # type: ignore[operator]


def test_reads_entries_and_sets_session_focus(tenant_id: str) -> None:
    sess_id = f"sess_{uuid.uuid4().hex}"
    with for_tenant(tenant_id) as session:
        session.add(AgentSession(session_id=sess_id, tenant_id=tenant_id, user_id="user_1"))
        batch_id = _seed(session, tenant_id)
        view = read_batch(session, tenant_id, sess_id, batch_id)

    assert isinstance(view, BatchView)
    assert view.transaction_count == 2
    assert view.checksum["result"] == "match"
    assert view.editable is True

    with for_tenant(tenant_id) as session:
        agent_session = session.get(AgentSession, sess_id)
        assert agent_session is not None
        assert agent_session.active_batch_id == batch_id


def test_only_suspects_filters_when_mismatch(tenant_id: str) -> None:
    sess_id = f"sess_{uuid.uuid4().hex}"
    with for_tenant(tenant_id) as session:
        session.add(AgentSession(session_id=sess_id, tenant_id=tenant_id, user_id="user_1"))
        # declared_total diferente do extraído -> mismatch, com suspeitos
        batch_id = _seed(session, tenant_id, declared_total=999999)
        full = read_batch(session, tenant_id, sess_id, batch_id)

    assert isinstance(full, BatchView)
    assert full.checksum["result"] == "mismatch"
    assert len(full.checksum["suspect_items"]) > 0

    with for_tenant(tenant_id) as session:
        only = read_batch(session, tenant_id, sess_id, batch_id, only_suspects=True)
    assert isinstance(only, BatchView)
    assert only.returned <= only.transaction_count
    assert all(t.suspect for t in only.transactions)
