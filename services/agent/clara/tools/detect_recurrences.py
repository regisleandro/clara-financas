"""Cobranças recorrentes — porta de
`agent/subagents/analyst/tools/detect_recurrences.ts`.

O critério é intervalo regular, não valor igual: assinatura que reajustou
continua sendo assinatura.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from clara.db.queries.ledger import load_ledger
from clara.ledger.analysis import detect_recurrences as _detect
from clara.ledger.money import format_cents
from clara.tools.analysis_scope import (
    AllScope,
    AnalysisScope,
    canonical_analysis_scope,
    draft_note,
    scope_filter,
    scope_label,
)
from clara.views.panels import Metric, MetricPanel, RecurrencesPanel, Row


def detect_recurrences(
    session: Session,
    tenant_id: str,
    scope: AnalysisScope | None = None,
    *,
    min_occurrences: int = 2,
) -> MetricPanel | RecurrencesPanel:
    resolved_scope = canonical_analysis_scope(scope if scope is not None else AllScope())
    ledger = load_ledger(session, tenant_id, scope_filter(resolved_scope))

    # Apelidos de comerciante aprovados (`MerchantAlias`) fundem grafias que o
    # truncamento sozinho não junta — chegam na Fase 6 (US4, aprendizado). Até
    # lá, o agrupamento usa só a identidade determinística de `merchant_key`.
    recurrences = _detect(ledger, min_occurrences=min_occurrences)

    if not recurrences:
        return MetricPanel(
            title="Cobranças recorrentes",
            summary=f"Nenhum padrão repetido foi encontrado em {scope_label(resolved_scope)}.",
            metric=Metric(
                label="Resultado",
                text="Nenhuma recorrência identificada",
                detail="São necessárias pelo menos duas cobranças em intervalos semelhantes.",
            ),
        )

    return RecurrencesPanel(
        title="Cobranças recorrentes",
        summary=(
            f"{len(recurrences)} "
            f"{'padrão encontrado' if len(recurrences) == 1 else 'padrões encontrados'} "
            f"em {scope_label(resolved_scope)}.{draft_note(ledger)}"
        ),
        rows=[
            Row(
                label=r.merchant,
                amount=r.annualized_cents,
                basis="projection",
                detail=(
                    f"{'Padrão confirmado' if r.confirmed else 'Padrão provável'} · "
                    f"{r.occurrences} ocorrências · última {format_cents(r.latest_amount)}"
                ),
                # O valor de cada linha é a projeção ANUALIZADA — a soma das
                # cobranças reais não fecha contra ele; os ids garantem que a
                # origem é real (`basis="projection"` diz isso explicitamente).
                transaction_ids=r.transaction_ids,
            )
            for r in recurrences
        ],
    )
