"""Tipos compartilhados do razão. Porta de `packages/ledger/src/types.ts`."""

from __future__ import annotations

from typing import Literal, TypedDict

EntryKind = Literal[
    "purchase",
    "payment",
    "refund",
    "fee",
    "adjustment",
    "income",
    "transfer",
    "card_payment",
    "cash_withdrawal",
]

Confidence = Literal["alta", "media", "baixa"]

DocumentKind = Literal["unknown", "credit_card_invoice", "bank_statement", "invoice_nfe"]

ChecksumResult = Literal["match", "mismatch", "no_declared_total"]
ChecksumCause = Literal["item", "rounding", "unknown"]


class TransactionLike(TypedDict, total=False):
    """O mínimo de uma transação que o razão precisa para calcular.

    `amount` é sempre em centavos, inteiro, sinalizado (despesa > 0, crédito < 0).
    """

    id: str
    amount: int
    kind: EntryKind
    extraction_confidence: Confidence
    page: int | None
