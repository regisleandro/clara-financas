"""Isolamento por tenant — porta de `packages/db/src/isolation.test.ts`.

Se algum destes falhar, a RLS não está fazendo o trabalho, e nenhuma outra
garantia do sistema importa: qualquer tenant leria o dado de qualquer outro.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from clara.db.tenant_scope import for_tenant


def _insert_document(tenant: str, doc_id: str) -> None:
    with for_tenant(tenant) as session:
        session.execute(
            text(
                "insert into documents (id, tenant_id, kind, blob_key, filename, content_hash) "
                "values (:id, :tid, 'credit_card_invoice', :key, 'fatura.pdf', :hash)"
            ),
            {"id": doc_id, "tid": tenant, "key": f"blob/{doc_id}", "hash": uuid.uuid4().hex},
        )


def test_for_tenant_requires_nonempty_tenant_id() -> None:
    with pytest.raises(ValueError):
        with for_tenant(""):
            pass


def test_tenant_only_sees_its_own_documents(tenant_id: str, other_tenant_id: str) -> None:
    doc_a = f"doc_{uuid.uuid4().hex}"
    doc_b = f"doc_{uuid.uuid4().hex}"
    _insert_document(tenant_id, doc_a)
    _insert_document(other_tenant_id, doc_b)

    with for_tenant(tenant_id) as session:
        rows = session.execute(text("select id from documents")).scalars().all()
        assert doc_a in rows
        assert doc_b not in rows

    with for_tenant(other_tenant_id) as session:
        rows = session.execute(text("select id from documents")).scalars().all()
        assert doc_b in rows
        assert doc_a not in rows


def test_insert_with_wrong_tenant_id_is_blocked_by_with_check(
    tenant_id: str, other_tenant_id: str
) -> None:
    """`WITH CHECK` recusa gravar uma linha marcada para o tenant errado."""
    with pytest.raises(DBAPIError):
        with for_tenant(tenant_id) as session:
            session.execute(
                text(
                    "insert into documents "
                    "(id, tenant_id, kind, blob_key, filename, content_hash) "
                    "values (:id, :wrong_tid, 'credit_card_invoice', 'k', 'f.pdf', :hash)"
                ),
                {
                    "id": f"doc_{uuid.uuid4().hex}",
                    "wrong_tid": other_tenant_id,
                    "hash": uuid.uuid4().hex,
                },
            )


def test_without_tenant_scope_nothing_matches(raw_session) -> None:  # noqa: ANN001
    """Sem `app.tenant_id`, `current_setting(..., true)` é NULL: a RLS não casa nada."""
    rows = raw_session.execute(text("select id from documents")).scalars().all()
    assert rows == []
