"""A fila de revisão — porta de `agent/tools/list_review_queue.ts`.

O predicado é o MESMO da tela e do snapshot do turno
(`clara/db/queries/review.py`), não uma cópia: fila e conversa divergirem
seria pior que a conversa não ter fila (FR-020).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from clara.db.category_labels import load_category_labels
from clara.db.models import Document, Transaction
from clara.db.queries.review import (
    ReviewReason,
    needs_review_condition,
    review_flags_condition,
    review_reasons_for,
    uncategorized_spend_condition,
)
from clara.ledger.categories import category_label
from clara.ledger.money import format_cents

LIMIT = 100


@dataclass(frozen=True)
class ReviewItem:
    id: str
    date: str
    # A descrição CRUA, não o palpite da Clara — é contra ela que a pessoa
    # confere.
    description: str
    merchant: str | None
    amount_cents: int
    amount_formatted: str
    kind: str
    category: str | None
    category_label: str
    confidence: str
    batch_id: str
    issuer: str | None
    reasons: list[ReviewReason]


@dataclass(frozen=True)
class UncategorizedSpending:
    count: int
    total_cents: int
    total_formatted: str
    scope: str  # "ledger" | "invoice"


@dataclass(frozen=True)
class ReviewQueueResult:
    pending: int
    returned: int
    items: list[ReviewItem] = field(default_factory=list)
    uncategorized_spending: UncategorizedSpending | None = None
    truncated: bool = False
    retry_with_include_reviewed: bool = False
    message: str | None = None
    note: str | None = None


def list_review_queue(
    session: Session,
    tenant_id: str,
    *,
    reasons: list[ReviewReason] | None = None,
    batch_id: str | None = None,
    include_reviewed: bool = False,
    limit: int = LIMIT,
) -> ReviewQueueResult:
    recorded = [
        Transaction.tenant_id == tenant_id,
        Transaction.status.in_(["confirmed", "adjustment"]),
        *([Transaction.batch_id == batch_id] if batch_id is not None else []),
    ]
    # O recorte listado pode incluir o atestado; a CONTA da fila nunca —
    # "quantos esperam revisão" é sempre o que ninguém olhou ainda.
    scope = and_(
        *recorded, review_flags_condition() if include_reviewed else needs_review_condition()
    )

    pending = session.execute(
        select(func.count())
        .where(and_(*recorded, needs_review_condition()))
        .select_from(Transaction)
    ).scalar_one()
    matched = session.execute(
        select(func.count()).where(scope).select_from(Transaction)
    ).scalar_one()
    spend_count, spend_total = session.execute(
        select(func.count(), func.coalesce(func.sum(Transaction.amount), 0)).where(
            and_(*recorded, uncategorized_spend_condition())
        )
    ).one()
    spend_total = int(spend_total)

    rows = session.execute(
        select(Transaction, Document.issuer)
        .join(Document, Document.id == Transaction.source_document_id)
        .where(scope)
        # Mais antigo primeiro: a fila é para ser esvaziada, e o que espera há
        # mais tempo é o que mais atrasa qualquer análise.
        .order_by(Transaction.date.asc())
        .limit(limit)
    ).all()

    labels = load_category_labels(session, tenant_id)
    all_items = [
        ReviewItem(
            id=t.id,
            date=t.date,
            description=t.original_description,
            merchant=t.merchant,
            amount_cents=t.amount,
            amount_formatted=format_cents(t.amount),
            kind=t.kind,
            category=t.category,
            category_label=category_label(labels, t.category),
            confidence=t.extraction_confidence,
            batch_id=t.batch_id,
            issuer=issuer,
            reasons=review_reasons_for(
                category=t.category,
                merchant=t.merchant,
                kind=t.kind,
                extraction_confidence=t.extraction_confidence,
            ),
        )
        for t, issuer in rows
    ]
    items = [
        item for item in all_items if reasons is None or any(r in reasons for r in item.reasons)
    ]

    uncategorized_spending = UncategorizedSpending(
        count=spend_count,
        total_cents=spend_total,
        total_formatted=format_cents(spend_total),
        scope="ledger" if batch_id is None else "invoice",
    )

    if not items:
        # Vazio com gasto sem categoria do outro lado NÃO é "não há nada": é
        # item atestado, e a saída é uma chamada, não um pedido de desculpa.
        attested_only = (
            not include_reviewed
            and spend_count > 0
            and (reasons is None or "sem_categoria" in reasons)
        )
        if attested_only:
            plural = "lançamento continua" if spend_count == 1 else "lançamentos continuam"
            message = (
                f"A fila não tem esses itens porque uma pessoa já os atestou, mas {spend_count} "
                f"{plural} sem categoria ({format_cents(spend_total)}). Repita esta chamada com "
                f"include_reviewed=True para listá-los; não responda que a consulta voltou vazia."
            )
        elif pending == 0:
            message = "Não há nada esperando revisão."
        else:
            message = "Nenhum item com esses motivos, embora a fila não esteja vazia."
        return ReviewQueueResult(
            pending=pending,
            returned=0,
            items=[],
            uncategorized_spending=uncategorized_spending,
            retry_with_include_reviewed=attested_only,
            message=message,
        )

    return ReviewQueueResult(
        pending=pending,
        returned=len(items),
        # Truncou quando o LIMITE cortou linhas, não quando o filtro de motivo
        # descartou algumas.
        truncated=matched > len(rows),
        items=items,
        uncategorized_spending=uncategorized_spending,
        note=(
            "Um item sai da fila com mark_reviewed, mesmo quando a leitura já estava certa — é "
            "o atestado que impede a fila de devolvê-lo para sempre."
        ),
    )
