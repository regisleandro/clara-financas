"""A trilha de reclassificação — porta de `agent/tools/read_reclassifications.ts`.

Leitura pura, sem gate: a trilha é append-only por grant de banco; o que sai
daqui é exatamente o que foi gravado, na ordem inversa da gravação.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import TransactionReclassification

LIMIT = 100


@dataclass(frozen=True)
class ReclassificationChange:
    transaction_id: str
    field: str
    previous_value: str | None
    new_value: str | None
    author: str
    reason: str | None
    by_concept_id: str | None
    changed_at: str


@dataclass(frozen=True)
class ReclassificationsResult:
    count: int
    changes: list[ReclassificationChange] = field(default_factory=list)
    truncated: bool = False
    note: str | None = None
    undo: str = (
        "Para desfazer: recategorize_transactions de volta ao previous_value — a trilha é "
        "append-only, o desfazer também fica registrado."
    )


def read_reclassifications(
    session: Session,
    tenant_id: str,
    *,
    transaction_id: str | None = None,
    by_concept_id: str | None = None,
    limit: int = 20,
) -> ReclassificationsResult:
    conditions = [TransactionReclassification.tenant_id == tenant_id]
    if transaction_id is not None:
        conditions.append(TransactionReclassification.transaction_id == transaction_id)
    if by_concept_id is not None:
        conditions.append(TransactionReclassification.by_concept_id == by_concept_id)

    rows = (
        session.execute(
            select(TransactionReclassification)
            .where(*conditions)
            .order_by(TransactionReclassification.created_at.desc())
            .limit(limit + 1)
        )
        .scalars()
        .all()
    )

    truncated = len(rows) > limit
    page = rows[:limit] if truncated else rows

    return ReclassificationsResult(
        count=len(page),
        truncated=truncated,
        note=(
            f"Mostrando as {limit} mudanças mais recentes; há mais. Filtre por transaction_id "
            f"ou by_concept_id, ou aumente o limit."
            if truncated
            else None
        ),
        changes=[
            ReclassificationChange(
                transaction_id=r.transaction_id,
                field=r.field,
                previous_value=r.previous_value,
                new_value=r.new_value,
                author=r.author,
                reason=r.reason,
                by_concept_id=r.by_concept_id,
                changed_at=r.created_at.isoformat(),
            )
            for r in page
        ],
    )
