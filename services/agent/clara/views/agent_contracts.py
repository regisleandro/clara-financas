"""O que os subagentes trocam com a coordenadora — porta de
`packages/views/src/agent-contracts.ts`.

O extrator persiste a extração completa e devolve um RECIBO — não a fatura
inteira — para que 100+ linhas não precisem ser retranscritas token a token
no contexto da coordenadora.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from clara.ledger.types import Confidence, DocumentKind, EntryKind


class Installment(BaseModel):
    current: int = Field(gt=0)
    total: int = Field(gt=0)


class DeclaredSubtotals(BaseModel):
    fees: int | None
    purchases: int | None


class ExtractedTransaction(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    original_description: str = Field(min_length=1)
    merchant: str | None
    amount: int
    kind: EntryKind
    installment: Installment | None
    category: str | None
    extraction_confidence: Confidence
    page: int | None = Field(default=None, gt=0)


class ExtractionResult(BaseModel):
    """O que `save_extraction` persiste em `extraction_stagings` — o formato
    completo, opaco para o banco, validado na fronteira pela tool."""

    document_id: str = Field(min_length=1)
    document_kind: DocumentKind = "credit_card_invoice"
    opening_balance: int | None = None
    closing_balance: int | None = None
    issuer: str | None
    period_start: str | None
    period_end: str | None
    due_date: str | None
    declared_total: int | None
    declared_subtotals: DeclaredSubtotals | None
    transactions: list[ExtractedTransaction]
    warnings: list[str] = Field(default_factory=list)


class ExtractionReceipt(BaseModel):
    """O que o extrator DEVOLVE à coordenadora: um recibo, não a fatura inteira."""

    extraction_id: str = Field(min_length=1)
    document_id: str = Field(min_length=1)
    document_kind: DocumentKind = "credit_card_invoice"
    opening_balance: int | None = None
    closing_balance: int | None = None
    issuer: str | None
    period_start: str | None
    period_end: str | None
    due_date: str | None
    declared_total: int | None
    declared_subtotals: DeclaredSubtotals | None
    transaction_count: int = Field(ge=0)
    warnings: list[str] = Field(default_factory=list)
    next_action: Literal["propose_batch_from_extraction"] = "propose_batch_from_extraction"
