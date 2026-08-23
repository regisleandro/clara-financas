"""Registra um compromisso — porta de `agent/tools/save_commitment.ts`.

Passa pelo gate porque é o que autoriza a Clara a **falar primeiro**. Um
lembrete que a pessoa não pediu é notificação indesejada, e a diferença
entre proatividade e incômodo é exatamente esse consentimento.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Commitment

CommitmentKind = Literal["invoice_due", "subscription_charge", "custom"]


@dataclass(frozen=True)
class SaveCommitmentResult:
    commitment_id: str
    due_date: str
    remind_days_before: int


def save_commitment(
    session: Session,
    tenant_id: str,
    *,
    kind: CommitmentKind,
    title: str,
    due_date: str,
    counterparty: str | None = None,
    recurrence_day_of_month: int | None = None,
    expected_amount: int | None = None,
    remind_days_before: int = 3,
) -> SaveCommitmentResult:
    # Reprocessar a mesma fatura não pode criar um segundo lembrete do mesmo
    # vencimento. `custom` fica de fora de propósito: lembretes livres da
    # pessoa são linhas independentes.
    existing = None
    if kind != "custom":
        existing = session.execute(
            select(Commitment).where(
                Commitment.tenant_id == tenant_id,
                Commitment.kind == kind,
                Commitment.counterparty.is_(counterparty)
                if counterparty is None
                else Commitment.counterparty == counterparty,
            )
        ).scalar_one_or_none()

    if existing is not None:
        existing.title = title
        existing.due_date = due_date
        existing.recurrence_day_of_month = recurrence_day_of_month
        existing.expected_amount = expected_amount
        existing.remind_days_before = remind_days_before
        # Salvar de novo REATIVA um lembrete desligado — aceitável porque
        # também passa pelo cartão.
        existing.active = "yes"
        session.flush()
        return SaveCommitmentResult(
            commitment_id=existing.id,
            due_date=existing.due_date,
            remind_days_before=remind_days_before,
        )

    commitment = Commitment(
        tenant_id=tenant_id,
        kind=kind,
        title=title,
        counterparty=counterparty,
        due_date=due_date,
        recurrence_day_of_month=recurrence_day_of_month,
        expected_amount=expected_amount,
        remind_days_before=remind_days_before,
    )
    session.add(commitment)
    session.flush()

    return SaveCommitmentResult(
        commitment_id=commitment.id, due_date=due_date, remind_days_before=remind_days_before
    )
