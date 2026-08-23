"""Imutabilidade do razão confirmado — porta de `ledger-immutability.test.ts`.

A hipótese que isto sustenta: uma vez confirmada, uma transação não é editada
nem apagada. Correção vira linha de ajuste. Depender de disciplina de código
seria depender de todo mundo lembrar, para sempre — por isso é um trigger.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from clara.db.tenant_scope import for_tenant


def _seed_confirmed_transaction(tenant: str) -> tuple[str, str, str]:
    doc_id = f"doc_{uuid.uuid4().hex}"
    batch_id = f"batch_{uuid.uuid4().hex}"
    txn_id = f"txn_{uuid.uuid4().hex}"
    with for_tenant(tenant) as session:
        session.execute(
            text(
                "insert into documents (id, tenant_id, kind, blob_key, filename, content_hash) "
                "values (:id, :tid, 'credit_card_invoice', 'k', 'f.pdf', :hash)"
            ),
            {"id": doc_id, "tid": tenant, "hash": uuid.uuid4().hex},
        )
        session.execute(
            text(
                "insert into batches (id, tenant_id, document_id, status) "
                "values (:id, :tid, :doc, 'confirmed')"
            ),
            {"id": batch_id, "tid": tenant, "doc": doc_id},
        )
        session.execute(
            text(
                "insert into transactions "
                "(id, tenant_id, batch_id, status, date, original_description, amount, "
                " extraction_confidence, source_document_id) "
                "values (:id, :tid, :batch, 'confirmed', '2026-01-05', 'Padaria', "
                "1500, 'alta', :doc)"
            ),
            {"id": txn_id, "tid": tenant, "batch": batch_id, "doc": doc_id},
        )
    return doc_id, batch_id, txn_id


def test_confirmed_transaction_amount_cannot_change(tenant_id: str) -> None:
    _, _, txn_id = _seed_confirmed_transaction(tenant_id)
    with pytest.raises(DBAPIError, match="não podem ser alterados"):
        with for_tenant(tenant_id) as session:
            session.execute(
                text("update transactions set amount = 9999 where id = :id"), {"id": txn_id}
            )


def test_confirmed_transaction_cannot_be_deleted(tenant_id: str) -> None:
    _, _, txn_id = _seed_confirmed_transaction(tenant_id)
    with pytest.raises(DBAPIError, match="não pode ser apagada"):
        with for_tenant(tenant_id) as session:
            session.execute(text("delete from transactions where id = :id"), {"id": txn_id})


def test_confirmed_transaction_category_can_change(tenant_id: str) -> None:
    """Categoria e comerciante são LEITURA, não FATO — mudam livremente mesmo confirmada."""
    _, _, txn_id = _seed_confirmed_transaction(tenant_id)
    with for_tenant(tenant_id) as session:
        session.execute(
            text("update transactions set category = 'groceries' where id = :id"), {"id": txn_id}
        )
        category = session.execute(
            text("select category from transactions where id = :id"), {"id": txn_id}
        ).scalar_one()
    assert category == "groceries"


def test_proposed_transaction_can_be_freely_edited(tenant_id: str) -> None:
    doc_id = f"doc_{uuid.uuid4().hex}"
    batch_id = f"batch_{uuid.uuid4().hex}"
    txn_id = f"txn_{uuid.uuid4().hex}"
    with for_tenant(tenant_id) as session:
        session.execute(
            text(
                "insert into documents (id, tenant_id, kind, blob_key, filename, content_hash) "
                "values (:id, :tid, 'credit_card_invoice', 'k', 'f.pdf', :hash)"
            ),
            {"id": doc_id, "tid": tenant_id, "hash": uuid.uuid4().hex},
        )
        session.execute(
            text("insert into batches (id, tenant_id, document_id) values (:id, :tid, :doc)"),
            {"id": batch_id, "tid": tenant_id, "doc": doc_id},
        )
        session.execute(
            text(
                "insert into transactions "
                "(id, tenant_id, batch_id, date, original_description, amount, "
                " extraction_confidence, source_document_id) "
                "values (:id, :tid, :batch, '2026-01-05', 'Padaria', 1500, 'alta', :doc)"
            ),
            {"id": txn_id, "tid": tenant_id, "batch": batch_id, "doc": doc_id},
        )
        session.execute(
            text("update transactions set amount = 2000 where id = :id"), {"id": txn_id}
        )


def test_confirmed_batch_status_does_not_regress(tenant_id: str) -> None:
    doc_id = f"doc_{uuid.uuid4().hex}"
    batch_id = f"batch_{uuid.uuid4().hex}"
    with for_tenant(tenant_id) as session:
        session.execute(
            text(
                "insert into documents (id, tenant_id, kind, blob_key, filename, content_hash) "
                "values (:id, :tid, 'credit_card_invoice', 'k', 'f.pdf', :hash)"
            ),
            {"id": doc_id, "tid": tenant_id, "hash": uuid.uuid4().hex},
        )
        session.execute(
            text(
                "insert into batches (id, tenant_id, document_id, status) "
                "values (:id, :tid, :doc, 'confirmed')"
            ),
            {"id": batch_id, "tid": tenant_id, "doc": doc_id},
        )
    with pytest.raises(DBAPIError, match="seu estado não retrocede"):
        with for_tenant(tenant_id) as session:
            session.execute(
                text("update batches set status = 'proposed' where id = :id"), {"id": batch_id}
            )
