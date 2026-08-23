"""O que faz um lançamento precisar de olho humano — o predicado, em um lugar só.

Porta de `packages/db/src/queries/review.ts`. Consumido pela fila de revisão,
pelo snapshot do razão (FR-021) e pela triagem do categorizador — os três
precisam concordar sempre, ou a conversa afirma "há N itens sem categoria" e
não consegue listá-los (FR-020).
"""

from __future__ import annotations

from typing import Literal

from sqlalchemy import ColumnElement, and_, or_

from clara.db.models import Transaction

ReviewReason = Literal["sem_categoria", "confianca_baixa", "sem_comerciante"]

# Pagamento de fatura e ajuste de saldo não esperam categoria nenhuma —
# contá-los infla o indicador com trabalho que não existe.
CATEGORIZABLE_KINDS = ("purchase", "refund", "fee")


def _is_categorizable(kind: str) -> bool:
    return kind in CATEGORIZABLE_KINDS


def uncategorized_spend_condition() -> ColumnElement[bool]:
    """Gasto que precisa de categoria — pagamento e ajuste ficam fora."""
    return and_(
        Transaction.category.is_(None),
        Transaction.kind.in_(CATEGORIZABLE_KINDS),
    )


def review_flags_condition() -> ColumnElement[bool]:
    """Os três motivos, SEM o filtro do atestado — separado de propósito.

    Confundir atestado com motivo produz uma resposta impossível de entender:
    "existem 2 sem categoria" (o snapshot, que não olha `reviewed_at`) seguido
    de "a fila não retornou nada" (que só enxerga o que ninguém atestou ainda).
    """
    return or_(
        uncategorized_spend_condition(),
        Transaction.extraction_confidence == "baixa",
        Transaction.merchant.is_(None),
    )


def needs_review_condition() -> ColumnElement[bool]:
    """Sai da fila quem foi ATESTADO (`reviewed_at`), não quem "parece resolvido"."""
    return and_(Transaction.reviewed_at.is_(None), review_flags_condition())


def review_reasons_for(
    *,
    category: str | None,
    merchant: str | None,
    kind: str,
    extraction_confidence: Literal["alta", "media", "baixa"],
) -> list[ReviewReason]:
    """Por que ESTE lançamento está na fila — pode ser mais de um motivo.

    Espelha `review_flags_condition()` linha por linha, inclusive o `kind`,
    para que a linha nunca apareça na fila sem nenhum motivo listado.
    """
    reasons: list[ReviewReason] = []
    if category is None and _is_categorizable(kind):
        reasons.append("sem_categoria")
    if extraction_confidence == "baixa":
        reasons.append("confianca_baixa")
    if merchant is None:
        reasons.append("sem_comerciante")
    return reasons
