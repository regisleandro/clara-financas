"""Avisos que a Clara já deu — porta de `agent/tools/list_notifications.ts`.

Leitura pura, sem gate. Fecha o ciclo da proatividade: o que foi dito,
quando, e se já foi visto.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Notification

LIMIT = 50


@dataclass(frozen=True)
class NotificationRow:
    kind: str
    title: str
    body: str
    commitment_id: str | None
    sent_at: str
    # `None` = ainda não visto; a agenda marca ao exibir.
    seen_at: str | None


@dataclass(frozen=True)
class ListNotificationsResult:
    count: int
    notifications: list[NotificationRow] = field(default_factory=list)
    truncated: bool = False
    note: str | None = None


def list_notifications(
    session: Session,
    tenant_id: str,
    *,
    unread_only: bool = False,
    limit: int = 20,
) -> ListNotificationsResult:
    conditions = [Notification.tenant_id == tenant_id]
    if unread_only:
        conditions.append(Notification.read_at.is_(None))

    rows = (
        session.execute(
            select(Notification)
            .where(*conditions)
            .order_by(Notification.created_at.desc())
            .limit(limit + 1)
        )
        .scalars()
        .all()
    )

    truncated = len(rows) > limit
    page = rows[:limit] if truncated else rows

    return ListNotificationsResult(
        count=len(page),
        truncated=truncated,
        note=f"Mostrando os {limit} avisos mais recentes; há mais." if truncated else None,
        notifications=[
            NotificationRow(
                kind=row.kind,
                title=row.title,
                body=row.body,
                commitment_id=row.commitment_id,
                sent_at=row.created_at.isoformat(),
                seen_at=None if row.read_at is None else row.read_at.isoformat(),
            )
            for row in page
        ],
    )
