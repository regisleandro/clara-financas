"""`resolve_invoice_focus` — a peça que existia sem `@tool` nenhum ligado a
ela (achado relendo `coordinator.md` contra o inventário real de tools)."""

from __future__ import annotations

import uuid

from clara.db.models import AgentSession, Batch, Document
from clara.db.tenant_scope import for_tenant
from clara.tools.invoice_focus import resolve_invoice_focus


def _batch(
    session,
    tenant: str,
    *,
    kind: str = "credit_card_invoice",
    checksum_result: str | None = "match",
) -> str:  # noqa: ANN001
    doc_id = f"doc_{uuid.uuid4().hex}"
    batch_id = f"batch_{uuid.uuid4().hex}"
    session.add(
        Document(
            id=doc_id,
            tenant_id=tenant,
            kind=kind,
            blob_key="k",
            filename="f.pdf",
            content_hash=uuid.uuid4().hex,
        )
    )
    session.flush()
    session.add(
        Batch(
            id=batch_id,
            tenant_id=tenant,
            document_id=doc_id,
            status="proposed",
            checksum_result=checksum_result,
        )
    )
    session.flush()
    return batch_id


def test_latest_prefers_credit_card_invoice_over_bank_statement(tenant_id: str) -> None:
    sess_id = f"sess_{uuid.uuid4().hex}"
    with for_tenant(tenant_id) as session:
        session.add(AgentSession(session_id=sess_id, tenant_id=tenant_id, user_id="user_1"))
        session.flush()
        _batch(session, tenant_id, kind="bank_statement")
        invoice_id = _batch(session, tenant_id, kind="credit_card_invoice")

    with for_tenant(tenant_id) as session:
        focus = resolve_invoice_focus(session, tenant_id, sess_id, "latest")

    assert focus is not None
    assert focus.batch_id == invoice_id


def test_latest_sets_session_focus(tenant_id: str) -> None:
    sess_id = f"sess_{uuid.uuid4().hex}"
    with for_tenant(tenant_id) as session:
        session.add(AgentSession(session_id=sess_id, tenant_id=tenant_id, user_id="user_1"))
        session.flush()
        invoice_id = _batch(session, tenant_id)

    with for_tenant(tenant_id) as session:
        resolve_invoice_focus(session, tenant_id, sess_id, "latest")

    with for_tenant(tenant_id) as session:
        agent_session = session.get(AgentSession, sess_id)
        assert agent_session is not None
        assert agent_session.active_batch_id == invoice_id


def test_next_with_divergence_is_idempotent_while_active_still_mismatches(tenant_id: str) -> None:
    sess_id = f"sess_{uuid.uuid4().hex}"
    with for_tenant(tenant_id) as session:
        session.add(AgentSession(session_id=sess_id, tenant_id=tenant_id, user_id="user_1"))
        session.flush()
        mismatched = _batch(session, tenant_id, checksum_result="mismatch")

    with for_tenant(tenant_id) as session:
        first = resolve_invoice_focus(session, tenant_id, sess_id, "next_with_divergence")
    with for_tenant(tenant_id) as session:
        second = resolve_invoice_focus(session, tenant_id, sess_id, "next_with_divergence")

    assert first is not None and first.batch_id == mismatched
    assert second is not None and second.batch_id == mismatched


def test_next_with_divergence_skip_active_moves_forward(tenant_id: str) -> None:
    sess_id = f"sess_{uuid.uuid4().hex}"
    with for_tenant(tenant_id) as session:
        session.add(AgentSession(session_id=sess_id, tenant_id=tenant_id, user_id="user_1"))
        session.flush()
        # Ordem de emissão mais recente primeiro (latest_invoice_order): cria
        # o segundo divergente DEPOIS para garantir que ele é o mais recente.
        first_mismatch = _batch(session, tenant_id, checksum_result="mismatch")
        second_mismatch = _batch(session, tenant_id, checksum_result="mismatch")

    with for_tenant(tenant_id) as session:
        first = resolve_invoice_focus(session, tenant_id, sess_id, "next_with_divergence")
    with for_tenant(tenant_id) as session:
        moved = resolve_invoice_focus(
            session, tenant_id, sess_id, "next_with_divergence", skip_active=True
        )

    assert first is not None
    assert first.batch_id in (first_mismatch, second_mismatch)
    assert moved is not None
    assert moved.batch_id in (first_mismatch, second_mismatch)
    assert moved.batch_id != first.batch_id


def test_active_reference_returns_none_without_prior_focus(tenant_id: str) -> None:
    sess_id = f"sess_{uuid.uuid4().hex}"
    with for_tenant(tenant_id) as session:
        session.add(AgentSession(session_id=sess_id, tenant_id=tenant_id, user_id="user_1"))
        session.flush()
        _batch(session, tenant_id)

    with for_tenant(tenant_id) as session:
        focus = resolve_invoice_focus(session, tenant_id, sess_id, "active")

    assert focus is None
