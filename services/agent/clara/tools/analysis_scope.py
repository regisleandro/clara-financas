"""O recorte de uma pergunta sobre o razão — porta de
`packages/agent/agent/lib/analysis-scope.ts` +
`packages/views/src/analysis-scope-contracts.ts`.

`invoice` é um recorte sobre o DOCUMENTO, não sobre o razão: perguntar de uma
fatura em conferência é perguntar do papel que está na mesa, e por isso é o
único recorte que inclui rascunho. `calendar_month`, `range` e `all` são
recortes do razão — ali rascunho viraria fato, e fica de fora.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

from clara.db.queries.ledger import LedgerFilter
from clara.instructions.dates import month_range


class CalendarMonthScope(BaseModel):
    kind: Literal["calendar_month"] = "calendar_month"
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    issuer: str | None = None


class InvoiceScope(BaseModel):
    kind: Literal["invoice"] = "invoice"
    batch_id: str = Field(min_length=1)


class RangeScope(BaseModel):
    kind: Literal["range"] = "range"
    from_: str = Field(alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$")
    to: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    issuer: str | None = None

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def _ordered(self) -> RangeScope:
        if self.from_ > self.to:
            raise ValueError("from deve ser anterior ou igual a to")
        return self


class AllScope(BaseModel):
    kind: Literal["all"] = "all"
    issuer: str | None = None


ComparableAnalysisScope = Annotated[
    CalendarMonthScope | InvoiceScope | RangeScope, Field(discriminator="kind")
]
AnalysisScope = Annotated[
    CalendarMonthScope | InvoiceScope | RangeScope | AllScope, Field(discriminator="kind")
]


def canonical_analysis_scope(scope: AnalysisScope) -> AnalysisScope:
    """Converte um intervalo que cobre exatamente um mês civil para a forma
    canônica `calendar_month`. Modelos diferentes expressam "janeiro" ora
    como mês, ora como 01/01–31/01; as duas consultas atingem as mesmas
    linhas, mas não têm a mesma semântica para rótulos e comparações."""
    if not isinstance(scope, RangeScope) or not scope.from_.endswith("-01"):
        return scope

    month = scope.from_[:7]
    from_, to = month_range(month)
    if scope.from_ != from_ or scope.to != to:
        return scope

    return CalendarMonthScope(month=month, issuer=scope.issuer)


def scope_filter(scope: AnalysisScope) -> LedgerFilter:
    if isinstance(scope, CalendarMonthScope):
        from_, to = month_range(scope.month)
        return LedgerFilter(from_=from_, to=to, issuer=scope.issuer)
    if isinstance(scope, InvoiceScope):
        return LedgerFilter(batch_id=scope.batch_id, include_proposed=True)
    if isinstance(scope, RangeScope):
        return LedgerFilter(from_=scope.from_, to=scope.to, issuer=scope.issuer)
    return LedgerFilter(issuer=scope.issuer)


def scope_label(scope: AnalysisScope) -> str:
    if isinstance(scope, CalendarMonthScope):
        return scope.month if scope.issuer is None else f"{scope.month} · {scope.issuer}"
    if isinstance(scope, InvoiceScope):
        return f"Fatura {scope.batch_id}"
    if isinstance(scope, RangeScope):
        base = f"{scope.from_} a {scope.to}"
        return base if scope.issuer is None else f"{base} · {scope.issuer}"
    return "Todo o razão" if scope.issuer is None else f"Todo o razão · {scope.issuer}"


def draft_note(entries: list) -> str:  # noqa: ANN001 - lista de LedgerEntry (dict com "status")
    """O aviso que acompanha todo painel montado sobre rascunho — uma frase
    no resumo, não um campo que a interface pode engolir."""
    drafts = sum(1 for e in entries if e["status"] == "proposed")
    if drafts == 0:
        return ""
    if drafts == len(entries):
        return " Esta fatura ainda está em conferência: nada aqui foi registrado no razão."
    plural = "lançamento ainda está" if drafts == 1 else "lançamentos ainda estão"
    return f" {drafts} {plural} em conferência."
