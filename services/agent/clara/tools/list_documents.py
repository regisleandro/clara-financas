"""Todos os documentos — inclusive os que nenhuma outra lista mostra.

Porta de `agent/tools/list_documents.ts`. `list_invoices` e o snapshot fazem
inner join com `batches`: um documento cuja extração falhou, ou cujo lote foi
rejeitado, não existia para a conversa. Aqui o join é aberto.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Batch, Document, ExtractionStaging

_HARD_LIMIT = 50


@dataclass
class DocumentRow:
    document_id: str
    display_label: str
    issuer: str | None
    kind: str
    uploaded_at: str
    batch: dict[str, Any] | None
    next: str | None
    staged_extraction_id: str | None = None


@dataclass
class ListDocumentsResult:
    count: int
    documents: list[DocumentRow] = field(default_factory=list)
    truncated: bool = False
    note: str | None = None


def list_documents(
    session: Session, tenant_id: str, *, without_batch: bool = False, limit: int = 20
) -> ListDocumentsResult:
    rows = session.execute(
        select(Document)
        .where(Document.tenant_id == tenant_id)
        .order_by(Document.uploaded_at.desc())
        .limit(_HARD_LIMIT + 1)
    ).scalars().all()

    truncated_all = len(rows) > _HARD_LIMIT
    page = rows[:_HARD_LIMIT] if truncated_all else rows
    ids = [r.id for r in page]

    latest_batch: dict[str, Batch] = {}
    staged_by_document: dict[str, str] = {}
    if ids:
        batch_rows = session.execute(
            select(Batch).where(Batch.document_id.in_(ids)).order_by(Batch.created_at.desc())
        ).scalars().all()
        # O lote mais recente conta a situação atual; um `rejected` antigo não
        # esconde um `proposed` novo.
        for batch in batch_rows:
            latest_batch.setdefault(batch.document_id, batch)

        staged_rows = session.execute(
            select(ExtractionStaging.id, ExtractionStaging.document_id).where(
                ExtractionStaging.document_id.in_(ids)
            )
        ).all()
        staged_by_document = {doc_id: sid for sid, doc_id in staged_rows}

    described: list[DocumentRow] = []
    for row in page:
        batch = latest_batch.get(row.id)
        staged_id = staged_by_document.get(row.id)

        if batch is None:
            next_step = (
                "extração pronta e sem lote: propose_batch_from_extraction"
                if staged_id is not None
                else "sem lote e sem extração: delegue ao extrator"
            )
        elif batch.status == "rejected":
            next_step = "lote descartado: para reaproveitar, delegue ao extrator e proponha de novo"
        else:
            next_step = None

        described.append(
            DocumentRow(
                document_id=row.id, display_label=row.issuer or "Documento enviado",
                issuer=row.issuer, kind=row.kind, uploaded_at=row.uploaded_at.isoformat(),
                batch=(
                    None if batch is None
                    else {
                        "batch_id": batch.id,
                        "status": batch.status,
                        "checksum_result": batch.checksum_result,
                    }
                ),
                staged_extraction_id=staged_id, next=next_step,
            )
        )

    filtered = [d for d in described if d.batch is None] if without_batch else described

    return ListDocumentsResult(
        count=len(filtered),
        documents=filtered[:limit],
        truncated=truncated_all,
        note=(
            f"Mostrando os {_HARD_LIMIT} documentos mais recentes; há mais."
            if truncated_all else None
        ),
    )
