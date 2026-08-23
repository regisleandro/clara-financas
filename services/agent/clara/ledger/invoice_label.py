"""Nome financeiro estável para um documento. Porta de `invoice-label.ts`.

O nome físico do PDF nunca participa do rótulo — é o que a interface mostra no
lugar de `filename`, que é só um identificador técnico interno.
"""

from __future__ import annotations

import re
from typing import Literal

FinancialDocumentKind = Literal["unknown", "credit_card_invoice", "bank_statement", "invoice_nfe"]

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")

_MONTH_NAMES_PT = (
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
)


def _short_date(iso_date: str) -> str:
    y, m, d = iso_date.split("-")
    return f"{d}/{m}/{y[2:]}"


def format_invoice_label(
    *, issuer: str | None = None, due_date: str | None = None, period_end: str | None = None
) -> str:
    """O vencimento é a data que a pessoa reconhece primeiro; na falta, o fim do ciclo."""
    origin = issuer.strip() if issuer and issuer.strip() else "Fatura"
    date = due_date or period_end
    if date is None or not _DATE_RE.match(date):
        return origin
    return f"{origin} {_short_date(date)}"


def format_document_label(
    *,
    issuer: str | None = None,
    due_date: str | None = None,
    period_end: str | None = None,
    document_kind: FinancialDocumentKind | None = "unknown",
) -> str:
    """Nome estável para qualquer documento, sem chamar extrato de fatura."""
    kind_label = {
        "bank_statement": "Extrato",
        "invoice_nfe": "Nota fiscal",
        "credit_card_invoice": "Fatura",
    }.get(document_kind or "unknown", "Documento")

    origin = issuer.strip() if issuer and issuer.strip() else kind_label
    date = due_date or period_end
    if date is None or not _DATE_RE.match(date):
        return f"{origin} · {kind_label}" if (issuer and issuer.strip()) else origin
    return f"{origin} · {kind_label} {_short_date(date)}"


def format_month_label(year_month: str) -> str:
    """`2026-06` como "junho de 2026". Devolve o mês cru se o formato não bater —
    inventar um nome de mês seria pior que mostrar o código."""
    if not _MONTH_RE.match(year_month):
        return year_month
    year, month = year_month.split("-")
    month_index = int(month) - 1
    if not (0 <= month_index < 12):
        return year_month
    return f"{_MONTH_NAMES_PT[month_index]} de {year}"
