"""A telemetria com leitor — porta dos casos de `read_tool_events.ts`."""

from __future__ import annotations

from clara.db.models import AgentToolEvent
from clara.db.tenant_scope import for_tenant
from clara.tools.read_tool_events import read_tool_events


def _add_event(session, tenant: str, *, tool_name: str, status: str) -> None:  # noqa: ANN001
    session.add(AgentToolEvent(tenant_id=tenant, tool_name=tool_name, status=status))
    session.flush()


def test_read_tool_events_filters_by_status(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _add_event(session, tenant_id, tool_name="commit_batch", status="ok")
        _add_event(session, tenant_id, tool_name="commit_batch", status="falha")

    with for_tenant(tenant_id) as session:
        result = read_tool_events(session, tenant_id, status="falha")

    assert result.count == 1
    assert result.events[0].status == "falha"


def test_read_tool_events_filters_by_tool_name(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _add_event(session, tenant_id, tool_name="commit_batch", status="ok")
        _add_event(session, tenant_id, tool_name="save_concept", status="ok")

    with for_tenant(tenant_id) as session:
        result = read_tool_events(session, tenant_id, tool_name="save_concept")

    assert result.count == 1
    assert result.events[0].tool_name == "save_concept"


def test_read_tool_events_truncates_and_says_so(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        for _ in range(3):
            _add_event(session, tenant_id, tool_name="commit_batch", status="ok")

    with for_tenant(tenant_id) as session:
        result = read_tool_events(session, tenant_id, limit=2)

    assert result.count == 2
    assert result.truncated is True
    assert result.note is not None
