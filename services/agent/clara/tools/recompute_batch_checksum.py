"""Reconfere um lote contra o total declarado e PERSISTE o resultado — porta
de `agent/lib/recompute-checksum.ts`.

Existia um buraco simétrico no TS que esta porta corrige ao nascer: qualquer
escrita que muda a soma de um lote confirmado (aqui, `create_adjustment`)
precisa chamar isto antes de retornar, na MESMA transação — senão
`checksum_result: mismatch` fica gravado para sempre mesmo depois de a
pessoa corrigir a diferença.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Batch, Document, Transaction
from clara.ledger.checksum import ChecksumReport, verify_checksum
from clara.ledger.statement import verify_statement_balance


@dataclass(frozen=True)
class RecomputedChecksum:
    checksum: ChecksumReport
    transaction_count: int


def recompute_batch_checksum(session: Session, tenant_id: str, batch: Batch) -> RecomputedChecksum:
    rows = (
        session.execute(
            select(Transaction).where(
                Transaction.batch_id == batch.id, Transaction.tenant_id == tenant_id
            )
        )
        .scalars()
        .all()
    )

    document_kind = session.execute(
        select(Document.kind).where(
            Document.id == batch.document_id, Document.tenant_id == tenant_id
        )
    ).scalar_one_or_none()

    as_dicts = [
        {
            "id": t.id,
            "amount": t.amount,
            "kind": t.kind,
            "extraction_confidence": t.extraction_confidence,
            "page": t.page,
        }
        for t in rows
    ]

    checksum = verify_checksum(
        transactions=as_dicts,  # type: ignore[arg-type]
        declared_total=batch.declared_total,
        declared_subtotals=batch.declared_subtotals,
    )

    statement_balance = None
    if document_kind == "bank_statement":
        statement_balance = verify_statement_balance(
            as_dicts,  # type: ignore[arg-type]
            batch.opening_balance,
            batch.closing_balance,
        )

    if statement_balance is None:
        persisted_result = checksum.result
        extracted_total = checksum.extracted_total
        persisted_report = dataclasses.asdict(checksum)
    else:
        persisted_result = (
            "match"
            if statement_balance.result == "match"
            else "mismatch"
            if statement_balance.result == "mismatch"
            else "no_declared_total"
        )
        extracted_total = statement_balance.net_movement
        persisted_report = dataclasses.asdict(statement_balance)

    batch.extracted_total = extracted_total
    batch.checksum_result = persisted_result
    batch.checksum_report = persisted_report

    return RecomputedChecksum(checksum=checksum, transaction_count=len(rows))
