"""A telemetria ganha leitor — porta de `agent/tools/read_tool_events.ts`.

`agent_tool_events` era escrita e lida por ninguém: diagnosticar dependia de
acesso direto ao banco. Leitura pura, sem gate — a tabela é append-only.
Carrega nada além do que o resumo já protege por construção: chaves, ids e
contagens, nunca valor, descrição ou senha.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import AgentToolEvent

LIMIT = 50

EventStatus = Literal["ok", "recuperavel", "falha"]


@dataclass(frozen=True)
class ToolEventRow:
    tool_name: str
    status: str
    error_code: str | None
    error_message: str | None
    duration_ms: int | None
    input_summary: dict[str, object] | None
    at: str


@dataclass(frozen=True)
class ReadToolEventsResult:
    count: int
    events: list[ToolEventRow] = field(default_factory=list)
    truncated: bool = False
    note: str | None = None


def read_tool_events(
    session: Session,
    tenant_id: str,
    *,
    status: EventStatus | None = None,
    tool_name: str | None = None,
    limit: int = 20,
) -> ReadToolEventsResult:
    conditions = [AgentToolEvent.tenant_id == tenant_id]
    if status is not None:
        conditions.append(AgentToolEvent.status == status)
    if tool_name is not None:
        conditions.append(AgentToolEvent.tool_name == tool_name)

    rows = (
        session.execute(
            select(AgentToolEvent)
            .where(*conditions)
            .order_by(AgentToolEvent.created_at.desc())
            .limit(limit + 1)
        )
        .scalars()
        .all()
    )

    truncated = len(rows) > limit
    page = rows[:limit] if truncated else rows

    return ReadToolEventsResult(
        count=len(page),
        truncated=truncated,
        note=(
            f"Mostrando os {limit} eventos mais recentes; há mais. Filtre por status ou "
            "tool_name."
            if truncated
            else None
        ),
        events=[
            ToolEventRow(
                tool_name=row.tool_name,
                status=row.status,
                error_code=row.error_code,
                error_message=row.error_message,
                duration_ms=row.duration_ms,
                input_summary=row.input_summary,
                at=row.created_at.isoformat(),
            )
            for row in page
        ],
    )
