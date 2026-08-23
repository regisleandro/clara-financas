"""Persiste a extração completa e devolve só o recibo — porta de
`subagents/extractor/tools/save_extraction.ts`.

É a metade do extrator na passagem por REFERÊNCIA: as 100+ linhas lidas do
PDF não voltam pelo contexto da coordenadora — ficam na staging, e o recibo
carrega o `extraction_id` que `propose_batch_from_extraction` consome.

Isolamento: a invariante do extrator é "não alcança o razão". Esta função só
escreve em `extraction_stagings`, tabela descartável sem relação com
`batches`/`transactions`.
"""

from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from clara.db.models import Document, ExtractionStaging
from clara.tools.errors import ToolError, not_found
from clara.views.agent_contracts import ExtractionReceipt, ExtractionResult


def save_extraction(
    session: Session,
    tenant_id: str,
    payload: ExtractionResult,
    *,
    parent_session_id: str | None = None,
) -> ExtractionReceipt | ToolError:
    document = session.execute(
        select(Document.id).where(
            Document.id == payload.document_id, Document.tenant_id == tenant_id
        )
    ).scalar_one_or_none()

    if document is None:
        return not_found(
            "documento_nao_encontrado", f"Nenhum documento com o id {payload.document_id}.",
            hint="Use o document_id exatamente como veio na requisição da coordenadora.",
        )

    extraction_id = f"ext_{uuid.uuid4().hex[:20]}"

    # Uma extração por documento: refazer a leitura substitui a anterior.
    session.execute(
        delete(ExtractionStaging).where(
            ExtractionStaging.tenant_id == tenant_id,
            ExtractionStaging.document_id == payload.document_id,
        )
    )
    session.add(
        ExtractionStaging(
            id=extraction_id, tenant_id=tenant_id, document_id=payload.document_id,
            parent_session_id=parent_session_id,
            payload=payload.model_dump(mode="json"),
        )
    )

    document_row = session.get(Document, payload.document_id)
    if document_row is not None:
        document_row.kind = payload.document_kind
    session.flush()

    return ExtractionReceipt(
        extraction_id=extraction_id, document_id=payload.document_id,
        document_kind=payload.document_kind, opening_balance=payload.opening_balance,
        closing_balance=payload.closing_balance, issuer=payload.issuer,
        period_start=payload.period_start, period_end=payload.period_end, due_date=payload.due_date,
        declared_total=payload.declared_total,
        declared_subtotals=payload.declared_subtotals,
        transaction_count=len(payload.transactions), warnings=payload.warnings,
    )
