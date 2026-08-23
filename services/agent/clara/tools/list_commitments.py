"""Compromissos ativos, do mais próximo ao mais distante — porta de
`agent/tools/list_commitments.ts`.

Leitura pura, sem gate. É o que o schedule consulta quando acorda e o que a
Clara usa para responder "o que vence".
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Commitment
from clara.instructions.dates import days_until, today_in_sao_paulo
from clara.ledger.money import format_cents


@dataclass(frozen=True)
class CommitmentRow:
    id: str
    title: str
    counterparty: str | None
    kind: str
    due_date: str
    days_until: int
    expected_amount: int | None
    expected_formatted: str | None
    remind_days_before: int


@dataclass(frozen=True)
class ListCommitmentsResult:
    today: str
    count: int
    commitments: list[CommitmentRow] = field(default_factory=list)


def list_commitments(
    session: Session, tenant_id: str, *, within_days: int | None = None
) -> ListCommitmentsResult:
    today = today_in_sao_paulo()

    rows = (
        session.execute(
            select(Commitment)
            .where(Commitment.tenant_id == tenant_id, Commitment.active == "yes")
            .order_by(Commitment.due_date.asc())
        )
        .scalars()
        .all()
    )

    enriched = [
        CommitmentRow(
            id=row.id,
            title=row.title,
            counterparty=row.counterparty,
            kind=row.kind,
            due_date=row.due_date,
            days_until=days_until(today, row.due_date),
            expected_amount=row.expected_amount,
            expected_formatted=(
                None if row.expected_amount is None else format_cents(row.expected_amount)
            ),
            remind_days_before=row.remind_days_before,
        )
        for row in rows
    ]
    filtered = (
        enriched
        if within_days is None
        else [row for row in enriched if row.days_until <= within_days]
    )

    return ListCommitmentsResult(today=today, count=len(filtered), commitments=filtered)
