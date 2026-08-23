"""coordinator_instructions() — o equivalente Agno de `instructions/estado.ts`."""

from __future__ import annotations

import uuid

from agno.run.base import RunContext

from clara.db.models import Document
from clara.db.tenant_scope import for_tenant
from clara.instructions.dynamic import coordinator_instructions


def _run_context(**overrides: object) -> RunContext:
    defaults: dict[str, object] = {
        "run_id": "run_1", "session_id": "sess_1", "user_id": "user_1",
        "dependencies": {"tenantId": "tenant_a"},
    }
    defaults.update(overrides)
    return RunContext(**defaults)  # type: ignore[arg-type]


def test_returns_only_static_instructions_without_tenant() -> None:
    blocks = coordinator_instructions(_run_context(dependencies={}))
    assert len(blocks) == 1
    assert "Identity" in blocks[0]


def test_injects_snapshot_for_authenticated_tenant(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        session.add(Document(id=f"doc_{uuid.uuid4().hex}", tenant_id=tenant_id,
                              kind="credit_card_invoice", blob_key="k", filename="f.pdf",
                              content_hash=uuid.uuid4().hex, issuer="Nubank"))

    blocks = coordinator_instructions(
        _run_context(dependencies={"tenantId": tenant_id}, session_id="sess_x")
    )
    assert len(blocks) == 2
    assert "Estado atual do razão" in blocks[1]
    assert '"today"' in blocks[1]
