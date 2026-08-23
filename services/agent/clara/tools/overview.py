"""O resumo da tela `/inicio` — porta de `apps/web/lib/overview-model.ts`.

Só números e proveniência; rótulos de mês/dia em português (`Intl.DateTimeFormat`
não tem equivalente direto em Python que valha a pena portar) ficam por conta
do `apps/web`, que já os formata. O que este módulo garante — e a razão dele
existir — é que a SOMA seja a mesma que a conversa usa: as duas leem
`clara/ledger/analysis.py`, nunca dois caminhos de cálculo para "quanto
gastei este mês".
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from clara.db.category_labels import load_category_labels
from clara.db.queries.ledger import LedgerFilter, load_ledger
from clara.ledger.analysis import aggregate_by_category, compare_periods, spendable, total_spend
from clara.ledger.categories import category_label
from clara.ledger.issuer import issuer_key
from clara.ledger.types import LedgerEntry

ALL_ISSUERS = "todas"


@dataclass(frozen=True)
class IssuerOption:
    key: str
    label: str


@dataclass(frozen=True)
class Comparison:
    previous_month: str
    previous_total: int
    delta: int
    delta_percent: float


@dataclass(frozen=True)
class CategoryShare:
    category: str | None
    label: str
    value: int
    share: float
    count: int


@dataclass(frozen=True)
class Insight:
    category: str | None
    label: str
    delta_ratio: float


@dataclass(frozen=True)
class Overview:
    months: list[str]
    issuers: list[IssuerOption]
    selected_month: str | None
    selected_issuer: str
    total: int
    credits: int
    net: int
    comparison: Comparison | None
    spark: list[int]
    range: tuple[str, str] | None
    categories: list[CategoryShare]
    insight: Insight | None


def _shift_month(year_month: str, delta: int) -> str:
    year, month = (int(p) for p in year_month.split("-"))
    total = year * 12 + (month - 1) + delta
    return f"{total // 12}-{(total % 12) + 1:02d}"


def _build_spark(entries: list[LedgerEntry]) -> list[int]:
    """Gasto acumulado ao longo do período, em até 12 passos."""
    if not entries:
        return []
    ordered = sorted(entries, key=lambda e: e["date"])
    total = sum(max(0, e["amount"]) for e in ordered)
    if total == 0:
        return []

    steps = 12
    per_step = -(-len(ordered) // steps)  # ceil division
    result: list[int] = []
    running = 0
    for index, entry in enumerate(ordered):
        running += max(0, entry["amount"])
        if (index + 1) % per_step == 0 or index == len(ordered) - 1:
            result.append(round((running / total) * 100))
    return result[:steps]


def _build_insight(
    current: list[LedgerEntry], previous: list[LedgerEntry], labels: dict[str, str]
) -> Insight | None:
    if not previous or not current:
        return None
    _total_delta, categories = compare_periods(current, previous)
    leader = next(
        (
            c
            for c in categories
            if c.category is not None and c.delta > 0 and c.share_of_change >= 0.25
        ),
        None,
    )
    if leader is None or leader.delta_ratio is None:
        return None
    return Insight(
        category=leader.category,
        label=category_label(labels, leader.category),
        delta_ratio=leader.delta_ratio,
    )


def build_overview(
    session: Session, tenant_id: str, *, month: str | None = None, issuer: str | None = None
) -> Overview:
    all_rows = load_ledger(session, tenant_id, LedgerFilter())
    spending = spendable(all_rows)

    months = sorted({r["date"][:7] for r in spending}, reverse=True)

    issuer_labels: dict[str, str] = {}
    for r in spending:
        key = issuer_key(r["issuer"])
        if key not in issuer_labels:
            issuer_labels[key] = r["issuer"] or "Sem origem identificada"
    issuers = sorted(
        (IssuerOption(key=k, label=v) for k, v in issuer_labels.items()), key=lambda i: i.label
    )

    selected_month = month if month in months else (months[0] if months else None)
    selected_issuer = issuer if issuer is not None and issuer in issuer_labels else ALL_ISSUERS

    if selected_month is None:
        return Overview(
            months=months,
            issuers=issuers,
            selected_month=None,
            selected_issuer=selected_issuer,
            total=0,
            credits=0,
            net=0,
            comparison=None,
            spark=[],
            range=None,
            categories=[],
            insight=None,
        )

    origin_rows = (
        spending
        if selected_issuer == ALL_ISSUERS
        else [r for r in spending if issuer_key(r["issuer"]) == selected_issuer]
    )
    current = [r for r in origin_rows if r["date"].startswith(selected_month)]
    previous_month = _shift_month(selected_month, -1)
    previous = [r for r in origin_rows if r["date"].startswith(previous_month)]

    # Compras — a mesma escala que a conversa usa (não o líquido). Créditos e
    # líquido não se perdem: viajam nomeados, à parte. `spendable()` já cuida
    # do filtro `counts_toward_declared_total` (e do ajuste de tipo que ele
    # exige) num lugar só.
    current_spendable = spendable(current)
    compras = sum(r["amount"] for r in current_spendable if r["amount"] > 0)
    creditos = sum(r["amount"] for r in current_spendable if r["amount"] < 0)
    liquido = total_spend(current).value
    previous_total = sum(r["amount"] for r in spendable(previous) if r["amount"] > 0)

    comparison = (
        None
        if previous_total == 0
        else Comparison(
            previous_month=previous_month,
            previous_total=previous_total,
            delta=compras - previous_total,
            delta_percent=round(((compras - previous_total) / previous_total) * 1000) / 10,
        )
    )

    dates = sorted(r["date"] for r in current)
    labels = load_category_labels(session, tenant_id)

    categories = [
        CategoryShare(
            category=c.category,
            label=category_label(labels, c.category),
            value=c.gross.value,
            share=c.share,
            count=c.count,
        )
        for c in aggregate_by_category(current)
        if c.gross.value > 0
    ][:6]

    return Overview(
        months=months,
        issuers=issuers,
        selected_month=selected_month,
        selected_issuer=selected_issuer,
        total=compras,
        credits=creditos,
        net=liquido,
        comparison=comparison,
        spark=_build_spark(current),
        range=(dates[0], dates[-1]) if dates else None,
        categories=categories,
        insight=_build_insight(current, previous, labels),
    )
