"""Corrigir um lote em rascunho — porta dos casos reais de
`edit_proposed_batch.ts`."""

from __future__ import annotations

import uuid

from clara.db.models import Batch, Concept, Document, Transaction
from clara.db.tenant_scope import for_tenant
from clara.tools.edit_proposed_batch import (
    EditProposedBatchResult,
    NewTransaction,
    TransactionEdit,
    edit_proposed_batch,
)


def _seed_draft(
    session,  # noqa: ANN001
    tenant: str,
    *,
    amount: int = 10000,
    declared_total: int = 10000,
    status: str = "proposed",
) -> tuple[str, str]:
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
            id=batch_id, tenant_id=tenant, document_id=doc_id, status=status,
            declared_total=declared_total,
        )
    )
    session.flush()
    session.add(
        Transaction(
            id=txn_id, tenant_id=tenant, batch_id=batch_id, status="proposed",
            date="2026-06-01", original_description="Compra crua", merchant="Loja X",
            amount=amount, kind="purchase", extraction_confidence="alta",
            source_document_id=doc_id,
        )
    )
    session.flush()
    return batch_id, txn_id


def _add_category(session, tenant: str, slug: str) -> None:  # noqa: ANN001
    session.add(
        Concept(
            tenant_id=tenant, bundle="learnings", type="Category",
            concept_id=f"categories/{slug}", frontmatter={"title": slug}, body="",
        )
    )
    session.flush()


def test_edit_proposed_batch_kind_fix_closes_a_payment_difference(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        batch_id, txn_id = _seed_draft(session, tenant_id, amount=10000, declared_total=0)

    with for_tenant(tenant_id) as session:
        result = edit_proposed_batch(
            session, tenant_id, batch_id=batch_id,
            edits=[TransactionEdit(transaction_id=txn_id, kind="payment")],
        )

    assert isinstance(result, EditProposedBatchResult)
    assert result.applied.edited == 1
    assert result.checksum.result == "match"


def test_edit_proposed_batch_removes_a_duplicate_line(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        batch_id, txn_id = _seed_draft(session, tenant_id, amount=10000, declared_total=0)

    with for_tenant(tenant_id) as session:
        result = edit_proposed_batch(
            session, tenant_id, batch_id=batch_id, remove_transaction_ids=[txn_id]
        )

    assert isinstance(result, EditProposedBatchResult)
    assert result.applied.removed == 1
    assert result.transaction_count == 0

    with for_tenant(tenant_id) as session:
        assert session.get(Transaction, txn_id) is None


def test_edit_proposed_batch_adds_a_missing_line(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        batch_id, _ = _seed_draft(session, tenant_id, amount=10000, declared_total=20000)

    with for_tenant(tenant_id) as session:
        result = edit_proposed_batch(
            session, tenant_id, batch_id=batch_id,
            add=[
                NewTransaction(
                    date="2026-06-02", original_description="Item esquecido", amount=10000
                )
            ],
        )

    assert isinstance(result, EditProposedBatchResult)
    assert result.applied.added == 1
    assert result.transaction_count == 2
    assert result.checksum.result == "match"


def test_edit_proposed_batch_merchant_correction_updates_merchant_key(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        batch_id, txn_id = _seed_draft(session, tenant_id)

    with for_tenant(tenant_id) as session:
        edit_proposed_batch(
            session, tenant_id, batch_id=batch_id,
            edits=[TransactionEdit(transaction_id=txn_id, merchant="Loja Y")],
        )

    with for_tenant(tenant_id) as session:
        txn = session.get(Transaction, txn_id)
        assert txn is not None
        assert txn.merchant == "Loja Y"
        assert txn.merchant_key is not None
        assert "loja y" in txn.merchant_key.lower()


def test_edit_proposed_batch_drops_unknown_category_instead_of_inventing_it(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        batch_id, txn_id = _seed_draft(session, tenant_id)

    with for_tenant(tenant_id) as session:
        result = edit_proposed_batch(
            session, tenant_id, batch_id=batch_id,
            edits=[TransactionEdit(transaction_id=txn_id, category="nao-existe")],
        )

    assert isinstance(result, EditProposedBatchResult)
    assert result.dropped_categories == ["nao-existe"]

    with for_tenant(tenant_id) as session:
        txn = session.get(Transaction, txn_id)
        assert txn is not None
        assert txn.category is None


def test_edit_proposed_batch_accepts_a_known_category(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _add_category(session, tenant_id, "groceries")
        batch_id, txn_id = _seed_draft(session, tenant_id)

    with for_tenant(tenant_id) as session:
        result = edit_proposed_batch(
            session, tenant_id, batch_id=batch_id,
            edits=[TransactionEdit(transaction_id=txn_id, category="groceries")],
        )

    assert isinstance(result, EditProposedBatchResult)
    assert result.dropped_categories == []

    with for_tenant(tenant_id) as session:
        txn = session.get(Transaction, txn_id)
        assert txn is not None
        assert txn.category == "groceries"


def test_edit_proposed_batch_refuses_an_already_confirmed_batch(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        batch_id, txn_id = _seed_draft(session, tenant_id, status="confirmed")

    with for_tenant(tenant_id) as session:
        result = edit_proposed_batch(
            session, tenant_id, batch_id=batch_id,
            edits=[TransactionEdit(transaction_id=txn_id, kind="payment")],
        )

    assert isinstance(result, dict)
    assert result["error"]["code"] == "lote_ja_decidido"


def test_edit_proposed_batch_refuses_an_empty_call(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        batch_id, _ = _seed_draft(session, tenant_id)

    with for_tenant(tenant_id) as session:
        result = edit_proposed_batch(session, tenant_id, batch_id=batch_id)

    assert isinstance(result, dict)
    assert result["error"]["code"] == "recorte_incompleto"


def test_edit_proposed_batch_unknown_batch_id_is_not_found(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        result = edit_proposed_batch(
            session, tenant_id, batch_id="batch_nao_existe",
            remove_transaction_ids=["txn_qualquer"],
        )

    assert isinstance(result, dict)
    assert result["error"]["code"] == "lote_nao_encontrado"
