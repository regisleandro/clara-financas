"""`load_ledger`/`ledger_coverage` contra Postgres real."""

from __future__ import annotations

import uuid

from clara.db.models import Batch, Document, Transaction
from clara.db.queries.ledger import LedgerCoverage, LedgerFilter, ledger_coverage, load_ledger
from clara.db.tenant_scope import for_tenant


def _seed(
    session,
    tenant: str,
    *,
    date: str,
    amount: int,
    kind: str = "purchase",
    status: str = "confirmed",
    issuer: str | None = "Nubank",
    category: str | None = None,
    original_description: str = "Padaria Sao Jose",
) -> str:  # noqa: ANN001
    doc_id = f"doc_{uuid.uuid4().hex}"
    batch_id = f"batch_{uuid.uuid4().hex}"
    txn_id = f"txn_{uuid.uuid4().hex}"
    session.add(
        Document(
            id=doc_id,
            tenant_id=tenant,
            kind="credit_card_invoice",
            blob_key="k",
            filename="f.pdf",
            content_hash=uuid.uuid4().hex,
            issuer=issuer,
        )
    )
    session.flush()
    session.add(Batch(id=batch_id, tenant_id=tenant, document_id=doc_id, status=status))
    session.flush()
    session.add(
        Transaction(
            id=txn_id,
            tenant_id=tenant,
            batch_id=batch_id,
            status=status,
            date=date,
            original_description=original_description,
            amount=amount,
            kind=kind,
            category=category,
            extraction_confidence="alta",
            source_document_id=doc_id,
        )
    )
    session.flush()
    return txn_id


def test_load_ledger_excludes_proposed_by_default(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        confirmed_id = _seed(session, tenant_id, date="2026-06-01", amount=1000)
        _seed(session, tenant_id, date="2026-06-02", amount=2000, status="proposed")

    with for_tenant(tenant_id) as session:
        rows = load_ledger(session, tenant_id)

    assert [r["id"] for r in rows] == [confirmed_id]


def test_load_ledger_includes_proposed_when_asked(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-01", amount=1000, status="proposed")

    with for_tenant(tenant_id) as session:
        rows = load_ledger(session, tenant_id, LedgerFilter(include_proposed=True))

    assert len(rows) == 1
    assert rows[0]["status"] == "proposed"


def test_load_ledger_carries_issuer_from_document_not_transaction(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-01", amount=1000, issuer="Itaú")

    with for_tenant(tenant_id) as session:
        rows = load_ledger(session, tenant_id)

    assert rows[0]["issuer"] == "Itaú"


def test_load_ledger_filters_by_issuer_case_and_accent_insensitively(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        wanted = _seed(session, tenant_id, date="2026-06-01", amount=1000, issuer="Itaú")
        _seed(session, tenant_id, date="2026-06-02", amount=500, issuer="Nubank")

    with for_tenant(tenant_id) as session:
        rows = load_ledger(session, tenant_id, LedgerFilter(issuer="itau"))

    assert [r["id"] for r in rows] == [wanted]


def test_load_ledger_search_matches_by_term_ignoring_accents(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        wanted = _seed(
            session,
            tenant_id,
            date="2026-06-01",
            amount=1000,
            original_description="PAGAMENTO EFETUADO PADARIA SÃO JOSÉ",
        )
        _seed(session, tenant_id, date="2026-06-02", amount=500, original_description="Farmácia")

    with for_tenant(tenant_id) as session:
        rows = load_ledger(session, tenant_id, LedgerFilter(search="sao jose"))

    assert [r["id"] for r in rows] == [wanted]


def test_load_ledger_batch_scope_ignores_date_range(tenant_id: str) -> None:
    """Fatura fechada em 07/07 cobre compras de 31/05 a 30/06 — `batch_id` é
    o recorte certo, não um intervalo de datas."""
    with for_tenant(tenant_id) as session:
        doc_id = f"doc_{uuid.uuid4().hex}"
        batch_id = f"batch_{uuid.uuid4().hex}"
        txn_id = f"txn_{uuid.uuid4().hex}"
        session.add(
            Document(
                id=doc_id,
                tenant_id=tenant_id,
                kind="credit_card_invoice",
                blob_key="k",
                filename="f.pdf",
                content_hash=uuid.uuid4().hex,
            )
        )
        session.flush()
        session.add(Batch(id=batch_id, tenant_id=tenant_id, document_id=doc_id, status="confirmed"))
        session.flush()
        session.add(
            Transaction(
                id=txn_id,
                tenant_id=tenant_id,
                batch_id=batch_id,
                status="confirmed",
                date="2026-05-31",
                original_description="Compra de maio",
                amount=1000,
                kind="purchase",
                extraction_confidence="alta",
                source_document_id=doc_id,
            )
        )
        session.flush()
        # fora de qualquer intervalo de datas plausível para "esta fatura"
        _seed(session, tenant_id, date="2026-09-01", amount=5000)

    with for_tenant(tenant_id) as session:
        rows = load_ledger(session, tenant_id, LedgerFilter(batch_id=batch_id))

    assert [r["id"] for r in rows] == [txn_id]


def test_ledger_coverage_reports_confirmed_span(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-05-01", amount=1000)
        _seed(session, tenant_id, date="2026-07-01", amount=2000)
        _seed(session, tenant_id, date="2026-08-01", amount=3000, status="proposed")

    with for_tenant(tenant_id) as session:
        coverage = ledger_coverage(session, tenant_id)

    assert coverage.count == 2
    assert coverage.first_date == "2026-05-01"
    assert coverage.last_date == "2026-07-01"


def test_ledger_coverage_empty_ledger(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        coverage = ledger_coverage(session, tenant_id)

    assert coverage == LedgerCoverage(count=0, first_date=None, last_date=None)
