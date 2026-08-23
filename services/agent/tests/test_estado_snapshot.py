"""load_snapshot() contra o banco de verdade — o que a Clara lê a cada turno."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from clara.db.models import AgentSession, Batch, Commitment, Document, Transaction
from clara.db.tenant_scope import for_tenant
from clara.instructions.estado import load_snapshot, render_snapshot


def _seed_invoice(
    session, tenant: str, *, status: str = "confirmed", issuer: str = "Nubank"  # noqa: ANN001
) -> tuple[str, str]:
    doc_id = f"doc_{uuid.uuid4().hex}"
    batch_id = f"batch_{uuid.uuid4().hex}"
    session.add(Document(
        id=doc_id, tenant_id=tenant, kind="credit_card_invoice", blob_key="k",
        filename="f.pdf", content_hash=uuid.uuid4().hex, issuer=issuer,
    ))
    session.flush()
    session.add(Batch(
        id=batch_id, tenant_id=tenant, document_id=doc_id, status=status,
        period_start="2026-06-01", period_end="2026-06-30", due_date="2026-07-07",
        declared_total=10000,
    ))
    session.flush()
    session.add(Transaction(
        id=f"txn_{uuid.uuid4().hex}", tenant_id=tenant, batch_id=batch_id,
        status="confirmed" if status == "confirmed" else "proposed",
        date="2026-06-15", original_description="Padaria", merchant="Padaria",
        amount=1000, kind="purchase", category=None,
        extraction_confidence="alta", source_document_id=doc_id,
    ))
    session.flush()
    return doc_id, batch_id


def test_snapshot_reads_invoices_coverage_and_uncategorized(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed_invoice(session, tenant_id)

    snapshot = load_snapshot(tenant_id)

    assert len(snapshot.invoices) == 1
    assert snapshot.invoices[0].issuer == "Nubank"
    assert snapshot.invoices[0].document_label == "Nubank · Fatura 07/07/26"
    assert snapshot.coverage.count == 1
    assert snapshot.uncategorized.count == 1
    assert snapshot.uncategorized.total_cents == 1000
    assert snapshot.issuers == ["Nubank"]
    assert snapshot.invoices_omitted == 0


def test_snapshot_excludes_rejected_batches(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed_invoice(session, tenant_id, status="rejected")

    snapshot = load_snapshot(tenant_id)
    assert snapshot.invoices == []


def test_snapshot_caps_at_twelve_most_recent_invoices(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        for _ in range(14):
            _seed_invoice(session, tenant_id)

    snapshot = load_snapshot(tenant_id)
    assert len(snapshot.invoices) == 12
    assert snapshot.invoices_omitted == 2


def test_active_invoice_at_turn_start_comes_from_agent_session(tenant_id: str) -> None:
    session_id = f"sess_{uuid.uuid4().hex}"
    with for_tenant(tenant_id) as session:
        _, batch_id = _seed_invoice(session, tenant_id)
        session.add(AgentSession(
            session_id=session_id, tenant_id=tenant_id, user_id="user_x",
            active_batch_id=batch_id, focus_updated_at=datetime.now(UTC),
        ))

    snapshot = load_snapshot(tenant_id, session_id)
    assert snapshot.active_invoice_at_turn_start is not None
    assert snapshot.active_invoice_at_turn_start.batch_id == batch_id


def test_active_invoice_is_none_without_session(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed_invoice(session, tenant_id)

    snapshot = load_snapshot(tenant_id)
    assert snapshot.active_invoice_at_turn_start is None


def test_learned_rule_and_commitment_counts(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        session.add(Commitment(
            id=f"commit_{uuid.uuid4().hex}", tenant_id=tenant_id, kind="invoice_due",
            title="Fatura Nubank", due_date="2026-07-07", active="yes",
        ))

    snapshot = load_snapshot(tenant_id)
    assert snapshot.open_commitment_count == 1
    assert snapshot.learned_rule_count == 0


def test_render_snapshot_is_valid_markdown_with_json_block(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed_invoice(session, tenant_id)

    snapshot = load_snapshot(tenant_id)
    text = render_snapshot(snapshot)
    assert "PRECEDÊNCIA" in text
    assert "```json" in text
    assert '"batch_id"' in text
