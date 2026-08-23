"""A fila de revisão e as escritas de US3 — porta dos casos reais de
`list_review_queue.ts`, `mark_reviewed.ts`, `recategorize_transactions.ts`,
`create_adjustment.ts`, `read_reclassifications.ts`, `name_issuer.ts`."""

from __future__ import annotations

import uuid

from clara.db.models import Batch, Document, Transaction
from clara.db.tenant_scope import for_tenant
from clara.tools.create_adjustment import AdjustmentResult, create_adjustment
from clara.tools.list_review_queue import ReviewQueueResult, list_review_queue
from clara.tools.mark_reviewed import mark_reviewed
from clara.tools.name_issuer import NameIssuerResult, name_issuer
from clara.tools.read_reclassifications import read_reclassifications
from clara.tools.recategorize_transactions import (
    CategoryChange,
    RecategorizeResult,
    recategorize_transactions,
)


def _seed(
    session,
    tenant: str,
    *,
    date: str = "2026-06-01",
    amount: int = 1000,
    category: str | None = None,
    merchant: str | None = "Loja X",
    confidence: str = "alta",
    status: str = "confirmed",
    declared_total: int | None = None,
) -> tuple[str, str, str]:  # noqa: ANN001
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
        )
    )
    session.flush()
    session.add(
        Batch(
            id=batch_id,
            tenant_id=tenant,
            document_id=doc_id,
            status="proposed",
            declared_total=declared_total,
        )
    )
    session.flush()
    session.add(
        Transaction(
            id=txn_id,
            tenant_id=tenant,
            batch_id=batch_id,
            status=status,
            date=date,
            original_description="Compra crua",
            merchant=merchant,
            amount=amount,
            kind="purchase",
            category=category,
            extraction_confidence=confidence,
            source_document_id=doc_id,
        )
    )
    session.flush()
    session.execute(Batch.__table__.update().where(Batch.id == batch_id).values(status="confirmed"))
    return doc_id, batch_id, txn_id


def _add_concept(session, tenant: str, slug: str) -> None:  # noqa: ANN001
    from clara.db.models import Concept

    session.add(
        Concept(
            id=f"cpt_{uuid.uuid4().hex}",
            tenant_id=tenant,
            bundle="learnings",
            type="Category",
            concept_id=f"categories/{slug}",
            frontmatter={"title": slug},
            body="",
        )
    )
    session.flush()


def test_review_queue_lists_uncategorized_oldest_first(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _, _, older = _seed(session, tenant_id, date="2026-06-01")
        _, _, newer = _seed(session, tenant_id, date="2026-06-10")

    with for_tenant(tenant_id) as session:
        result = list_review_queue(session, tenant_id)

    assert isinstance(result, ReviewQueueResult)
    assert [item.id for item in result.items] == [older, newer]
    assert all("sem_categoria" in item.reasons for item in result.items)


def test_review_queue_excludes_attested_by_default(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _add_concept(session, tenant_id, "groceries")
        _, _, txn_id = _seed(session, tenant_id, confidence="baixa")

    with for_tenant(tenant_id) as session:
        mark_reviewed(session, tenant_id, "user_1", [txn_id])

    with for_tenant(tenant_id) as session:
        result = list_review_queue(session, tenant_id)

    assert result.items == []
    assert result.retry_with_include_reviewed is True
    assert result.uncategorized_spending is not None
    assert result.uncategorized_spending.count == 1


def test_review_queue_include_reviewed_lists_attested_too(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _, _, txn_id = _seed(session, tenant_id)

    with for_tenant(tenant_id) as session:
        mark_reviewed(session, tenant_id, "user_1", [txn_id])

    with for_tenant(tenant_id) as session:
        result = list_review_queue(session, tenant_id, include_reviewed=True)

    assert [item.id for item in result.items] == [txn_id]


def test_mark_reviewed_then_reopen_round_trips(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _, _, txn_id = _seed(session, tenant_id)

    with for_tenant(tenant_id) as session:
        result = mark_reviewed(session, tenant_id, "user_1", [txn_id])
    assert result.reviewed == 1
    assert result.audited_by == "human:user_1"

    with for_tenant(tenant_id) as session:
        reopened = mark_reviewed(session, tenant_id, "user_1", [txn_id], reopen=True)
    assert reopened.reopened == 1

    with for_tenant(tenant_id) as session:
        result = list_review_queue(session, tenant_id)
    assert [item.id for item in result.items] == [txn_id]


def test_mark_reviewed_ignores_draft_transactions(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _, _, txn_id = _seed(session, tenant_id, status="proposed")

    with for_tenant(tenant_id) as session:
        result = mark_reviewed(session, tenant_id, "user_1", [txn_id])

    assert result.reviewed == 0
    assert result.not_found == [txn_id]


def test_recategorize_transactions_writes_reclassification_with_human_author(
    tenant_id: str,
) -> None:
    with for_tenant(tenant_id) as session:
        _add_concept(session, tenant_id, "groceries")
        _, _, txn_id = _seed(session, tenant_id)

    with for_tenant(tenant_id) as session:
        result = recategorize_transactions(
            session,
            tenant_id,
            "user_1",
            [CategoryChange(txn_id, "groceries", "Mercado")],
            reason="corrigindo",
        )

    assert isinstance(result, RecategorizeResult)
    assert result.changed == 1
    assert result.audited_by == "human:user_1"

    with for_tenant(tenant_id) as session:
        trail = read_reclassifications(session, tenant_id, transaction_id=txn_id)

    assert trail.count == 1
    assert trail.changes[0].author == "human:user_1"
    assert trail.changes[0].new_value == "groceries"
    assert trail.changes[0].previous_value is None


def test_recategorize_transactions_rejects_unknown_category(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _, _, txn_id = _seed(session, tenant_id)

    with for_tenant(tenant_id) as session:
        result = recategorize_transactions(
            session, tenant_id, "user_1", [CategoryChange(txn_id, "nao-existe", "?")]
        )

    assert isinstance(result, dict)
    assert result["error"]["code"] == "categoria_desconhecida"


def test_recategorize_transactions_no_op_change_is_an_error(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _add_concept(session, tenant_id, "groceries")
        _, _, txn_id = _seed(session, tenant_id, category="groceries")

    with for_tenant(tenant_id) as session:
        result = recategorize_transactions(
            session, tenant_id, "user_1", [CategoryChange(txn_id, "groceries", "Mercado")]
        )

    assert isinstance(result, dict)
    assert result["error"]["code"] == "nenhuma_alteracao"


def test_recategorize_transactions_never_touches_a_draft(tenant_id: str) -> None:
    """O trigger de imutabilidade protege CONFIRMADO; rascunho nem chega
    perto do gate — é `edit_proposed_batch` que corrige ali."""
    with for_tenant(tenant_id) as session:
        _add_concept(session, tenant_id, "groceries")
        _, _, txn_id = _seed(session, tenant_id, status="proposed")

    with for_tenant(tenant_id) as session:
        result = recategorize_transactions(
            session, tenant_id, "user_1", [CategoryChange(txn_id, "groceries", "Mercado")]
        )

    assert isinstance(result, dict)
    assert result["error"]["code"] == "nenhuma_alteracao"


def test_create_adjustment_is_a_delta_not_a_replacement(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _, batch_id, txn_id = _seed(session, tenant_id, amount=10000, declared_total=9000)

    with for_tenant(tenant_id) as session:
        result = create_adjustment(
            session,
            tenant_id,
            "user_1",
            transaction_id=txn_id,
            amount_cents=-1000,
            reason="cobrança duplicada",
        )

    assert isinstance(result, AdjustmentResult)
    assert result.original_amount_cents == 10000
    assert result.resulting_amount_cents == 9000
    assert result.batch_id == batch_id

    with for_tenant(tenant_id) as session:
        original = session.get(Transaction, txn_id)
        assert original is not None
        assert original.amount == 10000  # a linha original NUNCA muda

        adjustment = session.get(Transaction, result.adjustment_id)
        assert adjustment is not None
        assert adjustment.amount == -1000
        assert adjustment.status == "adjustment"
        assert adjustment.adjusts_transaction_id == txn_id


def test_create_adjustment_recomputes_the_batch_checksum(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _, batch_id, txn_id = _seed(session, tenant_id, amount=10000, declared_total=9000)

    with for_tenant(tenant_id) as session:
        batch = session.get(Batch, batch_id)
        assert batch is not None
        assert batch.checksum_result is None  # nunca conferido antes do ajuste

    with for_tenant(tenant_id) as session:
        create_adjustment(
            session,
            tenant_id,
            "user_1",
            transaction_id=txn_id,
            amount_cents=-1000,
            reason="fix",
        )

    with for_tenant(tenant_id) as session:
        batch = session.get(Batch, batch_id)
        assert batch is not None
        assert batch.checksum_result == "match"
        assert batch.extracted_total == 9000


def test_create_adjustment_refuses_zero_amount(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _, _, txn_id = _seed(session, tenant_id)

    with for_tenant(tenant_id) as session:
        result = create_adjustment(
            session, tenant_id, "user_1", transaction_id=txn_id, amount_cents=0, reason="nada"
        )

    assert isinstance(result, dict)
    assert result["error"]["code"] == "operacao_nao_permitida"


def test_create_adjustment_refuses_on_a_draft(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _, _, txn_id = _seed(session, tenant_id, status="proposed")

    with for_tenant(tenant_id) as session:
        result = create_adjustment(
            session, tenant_id, "user_1", transaction_id=txn_id, amount_cents=-100, reason="fix"
        )

    assert isinstance(result, dict)
    assert result["error"]["code"] == "operacao_nao_permitida"


def test_name_issuer_converges_spelling_with_existing_issuer(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        doc_id, _, _ = _seed(session, tenant_id)
        session.execute(
            Document.__table__.update().where(Document.id == doc_id).values(issuer=None)
        )
        other_doc_id = f"doc_{uuid.uuid4().hex}"
        session.add(
            Document(
                id=other_doc_id,
                tenant_id=tenant_id,
                kind="credit_card_invoice",
                blob_key="k",
                filename="f.pdf",
                content_hash=uuid.uuid4().hex,
                issuer="Nubank",
            )
        )
        session.flush()

    with for_tenant(tenant_id) as session:
        result = name_issuer(session, tenant_id, doc_id, "NUBANK")

    assert isinstance(result, NameIssuerResult)
    assert result.issuer == "Nubank"
    assert result.note is not None


def test_name_issuer_rejects_empty_name(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        doc_id, _, _ = _seed(session, tenant_id)

    with for_tenant(tenant_id) as session:
        result = name_issuer(session, tenant_id, doc_id, "   ")

    assert isinstance(result, dict)
    assert result["error"]["code"] == "operacao_nao_permitida"


def test_read_reclassifications_filters_by_concept_id(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _add_concept(session, tenant_id, "groceries")
        _, _, txn_id_a = _seed(session, tenant_id)
        _, _, txn_id_b = _seed(session, tenant_id)

    with for_tenant(tenant_id) as session:
        recategorize_transactions(
            session,
            tenant_id,
            "user_1",
            [CategoryChange(txn_id_a, "groceries", "Mercado")],
            by_concept_id="rules/x",
        )
        recategorize_transactions(
            session, tenant_id, "user_1", [CategoryChange(txn_id_b, "groceries", "Mercado")]
        )

    with for_tenant(tenant_id) as session:
        scoped = read_reclassifications(session, tenant_id, by_concept_id="rules/x")

    assert scoped.count == 1
    assert scoped.changes[0].transaction_id == txn_id_a
