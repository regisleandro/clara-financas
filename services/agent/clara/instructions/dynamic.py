"""Instruções dinâmicas — porta de `agent/instructions/estado.ts`.

No Agno, `instructions` aceita um `Callable[[RunContext], str | list[str]]`
resolvido a cada run (o equivalente a `turn.started`, não `session.started`):
dentro da MESMA conversa a pessoa aprova uma fatura, e o turno seguinte
precisa enxergar o razão já atualizado (FR-021).

Falha fechada: sem tenant autenticado, nada além das instruções estáticas é
injetado — um snapshot é dado financeiro de alguém, e degradar para "sem
contexto" é a única queda aceitável.
"""

from __future__ import annotations

from pathlib import Path

from agno.run.base import RunContext

from clara.instructions.estado import load_snapshot, render_snapshot
from clara.tools.tenant import (
    CrossTenantCallError,
    UnauthenticatedTenantError,
    require_tenant_caller,
)

_STATIC = (Path(__file__).parent / "coordinator.md").read_text()


def coordinator_instructions(run_context: RunContext | None) -> list[str]:
    # `run_context` chega None em chamadas de metadados/introspecção (ex.:
    # GET /teams do AgentOS, que monta a descrição da equipe fora de um run
    # de verdade) — sem sessão nenhuma, o único resultado seguro é o estático.
    if run_context is None:
        return [_STATIC]

    try:
        caller = require_tenant_caller(run_context)
    except (UnauthenticatedTenantError, CrossTenantCallError):
        return [_STATIC]

    snapshot = load_snapshot(caller.tenant_id, run_context.session_id)
    return [_STATIC, render_snapshot(snapshot)]
