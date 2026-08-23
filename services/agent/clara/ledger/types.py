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


class LedgerEntry(TypedDict):
    """Uma linha do razão como as análises a recebem — porta do `Transaction`
    de `packages/ledger/src/types.ts`. `issuer` não é coluna da transação: é
    do documento (`documents.issuer`), e chega aqui por composição na
    consulta (`clara/db/queries/ledger.py`), nunca gravada na linha."""

    id: str
    date: str
    amount: int
    kind: EntryKind
    category: str | None
    merchant: str | None
    merchant_key: str | None
    original_description: str
    extraction_confidence: Confidence
    status: str
    source_document_id: str
    page: int | None
    issuer: str | None
