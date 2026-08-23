"""Descartar uma fatura proposta — porta de `agent/tools/reject_batch.ts`.

O status `rejected` existe no schema desde o começo. Esta é a única função
que o escreve. Sem ela, "descartei" dito em prosa não muda nada no banco: o
rascunho segue `proposed` para sempre e reaparece no snapshot de todo turno.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from clara.db.models import Batch, Transaction
from clara.tools.errors import ToolError, not_found, refused


@dataclass
class RejectReceipt:
    batch_id: str
    status: str
    already_rejected: bool = False
    discarded_transactions: int = 0
    reason: str | None = None
    audited_by: str | None = None
    note: str | None = None


def reject_batch(
    session: Session, tenant_id: str, user_id: str, batch_id: str, reason: str
) -> RejectReceipt | ToolError:
    batch = session.execute(
        select(Batch).where(Batch.id == batch_id, Batch.tenant_id == tenant_id)
    ).scalar_one_or_none()

    if batch is None:
        return not_found(
            "lote_nao_encontrado", f"Nenhuma fatura com o id {batch_id}.",
            hint="Confira os batch_id do estado do razão, ou chame list_invoices.",
        )

    if batch.status == "rejected":
        return RejectReceipt(batch_id=batch.id, status="rejected", already_rejected=True)

    if batch.status == "confirmed":
        return refused(
            "lote_ja_registrado",
            "Esta fatura já está no razão, e o que foi registrado não se apaga.",
            hint=(
                "Para corrigir um valor dela, chame create_adjustment. "
                "Para revisar item a item, chame read_batch."
            ),
        )

    # Apagar só as linhas em rascunho: o filtro explícito garante que o
    # trigger de imutabilidade nunca precise recusar nada aqui.
    removed = session.execute(
        delete(Transaction)
        .where(
            Transaction.batch_id == batch.id,
            Transaction.tenant_id == tenant_id,
            Transaction.status == "proposed",
        )
        .returning(Transaction.id)
    ).scalars().all()

    session.execute(
        update(Batch)
        .where(Batch.id == batch.id, Batch.tenant_id == tenant_id)
        .values(status="rejected", approved_by=f"human:{user_id}", approved_at=datetime.now(UTC))
    )
    session.flush()

    return RejectReceipt(
        batch_id=batch.id, status="rejected", discarded_transactions=len(removed),
        reason=reason, audited_by=f"human:{user_id}",
        note=(
            "O documento continua registrado; "
            "para propor de novo a partir dele, use propose_batch."
        ),
    )
