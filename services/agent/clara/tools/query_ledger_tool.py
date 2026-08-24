"""`@tool` de fronteira para `query_ledger`."""

from __future__ import annotations

from typing import Any

from agno.run.base import RunContext
from agno.tools import tool

from clara.db.tenant_scope import for_tenant
from clara.ledger.types import Confidence, EntryKind
from clara.tools.analysis_scope import AnalysisScope
from clara.tools.query_ledger import query_ledger as _query
from clara.tools.serialize import to_tool_dict
from clara.tools.tenant import require_tenant_caller


@tool(
    name="query_ledger",
    description=(
        "Lists ledger transactions by period, text, or ids. Use to show where a number came "
        "from, or to answer questions about specific entries."
    ),
)
def query_ledger_tool(
    run_context: RunContext,
    scope: AnalysisScope | None = None,
    transaction_ids: list[str] | None = None,
    search: str | None = None,
    category: str | None = None,
    uncategorized_only: bool = False,
    kinds: list[EntryKind] | None = None,
    confidences: list[Confidence] | None = None,
    reviewed: bool | None = None,
) -> dict[str, Any]:
    caller = require_tenant_caller(run_context)
    with for_tenant(caller.tenant_id) as session:
        panel = _query(
            session,
            caller.tenant_id,
            scope=scope,
            transaction_ids=transaction_ids,
            search=search,
            category=category,
            uncategorized_only=uncategorized_only,
            kinds=kinds,
            confidences=confidences,
            reviewed=reviewed,
        )
    return to_tool_dict(panel)
