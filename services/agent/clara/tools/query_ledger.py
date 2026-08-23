"""Consulta de transações específicas — porta de
`agent/subagents/analyst/tools/query_ledger.ts`.

É a tool que responde "de onde veio esse valor": recebe os ids que outra
análise devolveu e mostra as linhas por trás do número.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from clara.db.category_labels import load_category_labels
from clara.db.queries.ledger import LedgerFilter, ledger_coverage, load_ledger
from clara.ledger.analysis import total_spend
from clara.ledger.categories import category_label
from clara.ledger.entry_kind import entry_kind_label, has_no_spend, non_spend_label
from clara.ledger.types import Confidence, EntryKind
from clara.tools.analysis_scope import (
    AllScope,
    AnalysisScope,
    canonical_analysis_scope,
    scope_filter,
    scope_label,
)
from clara.views.panels import Metric, MetricPanel, Row, TransactionsPanel

LIMIT = 100


def query_ledger(
    session: Session,
    tenant_id: str,
    *,
    scope: AnalysisScope | None = None,
    transaction_ids: list[str] | None = None,
    search: str | None = None,
    category: str | None = None,
    uncategorized_only: bool = False,
    kinds: list[EntryKind] | None = None,
    confidences: list[Confidence] | None = None,
    reviewed: bool | None = None,
) -> MetricPanel | TransactionsPanel:
    resolved_scope = canonical_analysis_scope(scope if scope is not None else AllScope())
    base = scope_filter(resolved_scope)
    rows = load_ledger(
        session,
        tenant_id,
        LedgerFilter(
            from_=base.from_,
            to=base.to,
            issuer=base.issuer,
            batch_id=base.batch_id,
            include_proposed=base.include_proposed,
            ids=transaction_ids,
            search=search,
            kinds=kinds,
            confidences=confidences,
            reviewed=reviewed,
            category=category,
            has_category=False if uncategorized_only else None,
        ),
    )

    label = scope_label(resolved_scope)

    if not rows:
        coverage = ledger_coverage(session, tenant_id)
        detail = (
            "O razão ainda não possui lançamentos confirmados."
            if coverage.count == 0
            else f"A cobertura disponível vai de {coverage.first_date} a {coverage.last_date}."
        )
        return MetricPanel(
            title="Lançamentos",
            summary=f"Nenhum lançamento corresponde a {label} e aos filtros informados.",
            metric=Metric(label="Resultado", text="Sem lançamentos", detail=detail),
        )

    spend = total_spend(rows)
    truncated = len(rows) > LIMIT
    labels = load_category_labels(session, tenant_id)
    draft_count = sum(1 for r in rows if r["status"] == "proposed")

    # "Nada aqui conta como gasto?" é derivado do que ESTÁ no recorte — sem
    # lista de exceções a manter em dia.
    no_spend = has_no_spend(rows)  # type: ignore[arg-type]
    metric_ids = [r["id"] for r in rows] if no_spend else spend.transaction_ids
    metric_amount = sum(r["amount"] for r in rows) if no_spend else spend.value

    summary = (
        f"{len(rows)} "
        f"{'lançamento encontrado' if len(rows) == 1 else 'lançamentos encontrados'} em {label}."
        + (f" Exibindo os primeiros {LIMIT}." if truncated else "")
        + (f" {draft_count} ainda em conferência." if draft_count > 0 else "")
    )

    return TransactionsPanel(
        title="Lançamentos",
        summary=summary,
        metric=Metric(
            label=non_spend_label(rows) if no_spend else "Gastos do recorte",  # type: ignore[arg-type]
            amount=metric_amount,
            detail=f"{label} · nada aqui conta como gasto" if no_spend else label,
            transaction_ids=metric_ids,
        ),
        rows=[
            Row(
                label=r["merchant"] or r["original_description"],
                amount=r["amount"],
                detail=(
                    f"{r['date']} · {entry_kind_label(r['kind'])} · "
                    f"{category_label(labels, r['category'])} · "
                    f"confiança {r['extraction_confidence']}"
                    + (" · em conferência" if r["status"] == "proposed" else "")
                ),
                transaction_ids=[r["id"]],
            )
            for r in rows[:LIMIT]
        ],
    )
