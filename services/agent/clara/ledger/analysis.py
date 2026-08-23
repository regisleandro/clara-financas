"""Agregações do razão. Porta de `packages/ledger/src/analysis.ts`.

Regra que atravessa o módulo inteiro: **todo número vem acompanhado dos ids
das transações que o compõem.** Não é um extra de auditoria — é o que faz
"de onde veio esse valor?" ter resposta sempre, sem recalcular nada.

Funções puras sobre linhas já confirmadas — nada aqui chama modelo nem banco.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from clara.ledger.categories import category_slug
from clara.ledger.checksum import counts_toward_declared_total
from clara.ledger.issuer import issuer_key
from clara.ledger.merchant import cluster_merchant_keys, merchant_key
from clara.ledger.types import LedgerEntry


@dataclass(frozen=True)
class Provenance:
    value: int
    transaction_ids: list[str]


def spendable(transactions: list[LedgerEntry]) -> list[LedgerEntry]:
    """Lançamentos que representam gasto do período. Pagamento não é gasto."""
    return [t for t in transactions if counts_toward_declared_total(t)]  # type: ignore[arg-type]


def total_spend(transactions: list[LedgerEntry]) -> Provenance:
    counted = spendable(transactions)
    return Provenance(
        value=sum(t["amount"] for t in counted),
        transaction_ids=[t["id"] for t in counted],
    )


@dataclass(frozen=True)
class CategoryTotal:
    category: str | None
    value: int
    transaction_ids: list[str]
    count: int
    # Fração das COMPRAS do período, 0–1. Só para exibição.
    share: float
    # Compras da categoria — só o que é positivo. "Quanto gastei" tem duas
    # respostas legítimas (bruto e líquido) e elas não convivem na mesma
    # escala sem dizer qual é qual — daí a separação viver aqui, não em cada
    # consumidor (duas cópias da mesma definição é como elas voltam a divergir).
    gross: Provenance
    # Créditos da categoria — estornos e descontos, sempre negativos.
    credits: Provenance


def aggregate_by_category(transactions: list[LedgerEntry]) -> list[CategoryTotal]:
    """Composição por categoria, do maior para o menor.

    Transações sem categoria vêm como `category=None`, nunca escondidas ou
    jogadas num "outros": o que ainda não foi categorizado é justamente o
    que precisa de atenção.
    """
    counted = spendable(transactions)
    buckets: dict[str | None, dict] = {}

    for t in counted:
        # A chave é o SLUG, não a string crua: `entertainment` e
        # `categories/entertainment` são a mesma categoria escrita de duas
        # formas, e agrupar pela string crua faria delas duas linhas.
        key = None if t["category"] is None else category_slug(t["category"])
        bucket = buckets.setdefault(
            key,
            {
                "value": 0,
                "ids": [],
                "gross_value": 0,
                "gross_ids": [],
                "credit_value": 0,
                "credit_ids": [],
            },
        )
        bucket["value"] += t["amount"]
        bucket["ids"].append(t["id"])
        if t["amount"] < 0:
            bucket["credit_value"] += t["amount"]
            bucket["credit_ids"].append(t["id"])
        else:
            bucket["gross_value"] += t["amount"]
            bucket["gross_ids"].append(t["id"])

    # A base da fração é o que a BARRA representa — compras. Usar o líquido
    # desenhava barra curta ao lado de um valor alto quando havia estorno.
    gross_total = sum(b["gross_value"] for b in buckets.values())

    totals = [
        CategoryTotal(
            category=category,
            value=b["value"],
            transaction_ids=b["ids"],
            count=len(b["ids"]),
            share=0.0 if gross_total == 0 else b["gross_value"] / gross_total,
            gross=Provenance(b["gross_value"], b["gross_ids"]),
            credits=Provenance(b["credit_value"], b["credit_ids"]),
        )
        for category, b in buckets.items()
    ]
    return sorted(totals, key=lambda t: (-t.gross.value, -t.value))


@dataclass(frozen=True)
class CategoryComparison:
    category: str | None
    current: Provenance
    previous: Provenance
    delta: int
    delta_ratio: float | None
    # Quanto esta categoria explica da variação total, 0–1.
    share_of_change: float


def compare_periods(
    current: list[LedgerEntry], previous: list[LedgerEntry]
) -> tuple[int, list[CategoryComparison]]:
    """Comparação entre dois períodos, por categoria.

    `share_of_change` sustenta "restaurantes explicam 62% do aumento": a
    contribuição da categoria para a variação TOTAL, não a variação dela
    isolada — sem isso uma categoria que dobrou de R$10 para R$20 pareceria
    mais relevante que uma que subiu R$800.
    """
    current_by_category = {t.category: t for t in aggregate_by_category(current)}
    previous_by_category = {t.category: t for t in aggregate_by_category(previous)}
    categories = set(current_by_category) | set(previous_by_category)
    total_delta = total_spend(current).value - total_spend(previous).value

    # Base da atribuição: só os aumentos. Misturar quedas diluiria a
    # explicação — se uma categoria cai e outra sobe, o total pode nem mudar,
    # mas o aumento continua tendo uma causa identificável.
    total_increase = sum(
        max(
            0,
            (current_by_category.get(c).value if c in current_by_category else 0)
            - (previous_by_category.get(c).value if c in previous_by_category else 0),
        )
        for c in categories
    )

    rows: list[CategoryComparison] = []
    for category in categories:
        now = current_by_category.get(category)
        before = previous_by_category.get(category)
        current_value = now.value if now is not None else 0
        previous_value = before.value if before is not None else 0
        delta = current_value - previous_value
        rows.append(
            CategoryComparison(
                category=category,
                current=Provenance(current_value, now.transaction_ids if now is not None else []),
                previous=Provenance(
                    previous_value, before.transaction_ids if before is not None else []
                ),
                delta=delta,
                delta_ratio=None if previous_value == 0 else delta / previous_value,
                share_of_change=0.0 if total_increase == 0 else max(0, delta) / total_increase,
            )
        )

    return total_delta, sorted(rows, key=lambda r: -r.delta)


@dataclass(frozen=True)
class Bucket:
    value: int
    transaction_ids: list[str]
    count: int


def _empty_bucket() -> Bucket:
    return Bucket(0, [], 0)


def _add(bucket: Bucket, entry: LedgerEntry) -> Bucket:
    return Bucket(
        value=bucket.value + entry["amount"],
        transaction_ids=[*bucket.transaction_ids, entry["id"]],
        count=bucket.count + 1,
    )


@dataclass(frozen=True)
class IssuerRow:
    key: str
    issuer: str | None
    total: Bucket
    # Uma posição por mês, na mesma ordem de `IssuerMonthMatrix.months`.
    # `None` = a operadora não tem lançamento naquele mês (diferente de zero,
    # que seria "tem lançamentos e eles se anulam").
    by_month: list[Bucket | None]


@dataclass(frozen=True)
class IssuerMonthMatrix:
    # `YYYY-MM` presentes no razão, do mais recente para o mais antigo.
    months: list[str]
    issuers: list[IssuerRow]
    month_totals: list[Bucket] = field(default_factory=list)
    total: Bucket = field(default_factory=_empty_bucket)


def aggregate_by_issuer_month(entries: list[LedgerEntry]) -> IssuerMonthMatrix:
    """O razão cruzado por operadora e mês.

    Três decisões: (1) o mês é o da COMPRA, não o do fechamento da fatura —
    uma fatura fechada em julho cobre gastos de maio/junho; (2) operadora
    `None` aparece como linha — documento sem operadora identificada é
    justamente o que precisa de atenção; (3) toda célula carrega os
    `transaction_ids` — é onde mais se pergunta "quais gastos são esses?".
    """
    counted = spendable(entries)

    months = sorted({t["date"][:7] for t in counted}, reverse=True)
    month_index = {month: position for position, month in enumerate(months)}

    by_issuer: dict[str, list[Bucket | None]] = {}
    spelling: dict[str, tuple[str | None, str]] = {}
    month_totals = [_empty_bucket() for _ in months]
    total = _empty_bucket()

    for entry in counted:
        position = month_index[entry["date"][:7]]
        issuer = entry["issuer"]
        key = issuer_key(issuer)

        known = spelling.get(key)
        if known is None or entry["date"] > known[1]:
            spelling[key] = (issuer, entry["date"])

        row = by_issuer.setdefault(key, [None] * len(months))
        row[position] = _add(row[position] or _empty_bucket(), entry)

        month_totals[position] = _add(month_totals[position], entry)
        total = _add(total, entry)

    issuers = [
        IssuerRow(
            key=key,
            issuer=spelling[key][0],
            total=Bucket(
                value=sum(cell.value for cell in by_month if cell is not None),
                transaction_ids=[
                    tid for cell in by_month if cell is not None for tid in cell.transaction_ids
                ],
                count=sum(cell.count for cell in by_month if cell is not None),
            ),
            by_month=by_month,
        )
        for key, by_month in by_issuer.items()
    ]
    issuers.sort(key=lambda row: -row.total.value)

    return IssuerMonthMatrix(months=months, issuers=issuers, month_totals=month_totals, total=total)


@dataclass(frozen=True)
class Recurrence:
    merchant: str
    value: int
    transaction_ids: list[str]
    # Quantas COBRANÇAS, não quantas linhas: o IOF anda junto da compra.
    occurrences: int
    latest_amount: int
    first_amount: int
    price_change_ratio: float | None
    median_interval_days: int
    # Projeção anual: valor mais recente na cadência mediana observada.
    annualized_cents: int
    # `False` quando só há duas cobranças — um padrão PROVÁVEL, não um fato.
    confirmed: bool


@dataclass(frozen=True)
class _Charge:
    date: str
    amount: int
    transaction_ids: list[str]


def _identity_of(t: LedgerEntry) -> str | None:
    if t.get("merchant_key"):
        return t["merchant_key"]
    return merchant_key(original_description=t["original_description"], merchant=t["merchant"])


def _label_of(group: list[LedgerEntry]) -> str:
    latest = max(group, key=lambda t: t["date"])
    return latest["merchant"] or latest["original_description"]


def _to_charges(group: list[LedgerEntry]) -> list[_Charge]:
    """Colapsa encargos na compra do mesmo dia. O IOF de uma assinatura
    internacional é lançado como linha própria, na mesma data e mesmo
    comerciante — é parte do custo (entra no valor), mas não é um evento de
    cobrança e não pode contar como intervalo."""
    by_date: dict[str, _Charge] = {}
    for t in sorted(group, key=lambda t: t["date"]):
        existing = by_date.get(t["date"])
        if existing is None:
            by_date[t["date"]] = _Charge(t["date"], t["amount"], [t["id"]])
        else:
            by_date[t["date"]] = _Charge(
                existing.date, existing.amount + t["amount"], [*existing.transaction_ids, t["id"]]
            )
    return sorted(by_date.values(), key=lambda c: c.date)


def _days_between(a: str, b: str) -> int:
    from datetime import date

    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def _median(values: list[int]) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 0:
        return round((ordered[middle - 1] + ordered[middle]) / 2)
    return ordered[middle]


def detect_recurrences(
    transactions: list[LedgerEntry],
    *,
    min_occurrences: int = 2,
    merchant_aliases: list[list[str]] | None = None,
) -> list[Recurrence]:
    """Cobranças que se repetem no mesmo comerciante.

    O critério é intervalo regular, não valor igual: assinatura que
    reajustou continua sendo assinatura. Mínimo de 2 ocorrências, marcadas
    como não confirmadas — exigir 3 significa não responder nada até a
    terceira fatura, quando com duas o padrão já é visível.
    """
    counted = [t for t in spendable(transactions) if _identity_of(t) is not None]

    cluster = cluster_merchant_keys((_identity_of(t) for t in counted), merchant_aliases or [])
    by_identity: dict[str, list[LedgerEntry]] = {}
    for t in counted:
        identity = cluster[_identity_of(t)]  # type: ignore[index]
        by_identity.setdefault(identity, []).append(t)

    recurrences: list[Recurrence] = []
    for group in by_identity.values():
        charges = _to_charges(group)
        if len(charges) < min_occurrences:
            continue

        intervals = [
            _days_between(charges[i - 1].date, charges[i].date) for i in range(1, len(charges))
        ]
        median_interval = _median(intervals)
        # Entre 3 e 5 semanas cobre mensal com variação de dia de fechamento.
        if median_interval < 21 or median_interval > 38:
            continue

        first, latest = charges[0], charges[-1]
        recurrences.append(
            Recurrence(
                merchant=_label_of(group),
                occurrences=len(charges),
                value=sum(c.amount for c in charges),
                transaction_ids=[tid for c in charges for tid in c.transaction_ids],
                first_amount=first.amount,
                latest_amount=latest.amount,
                price_change_ratio=(
                    None if first.amount == 0 else (latest.amount - first.amount) / first.amount
                ),
                median_interval_days=median_interval,
                # Cadência OBSERVADA, não "×12": um multiplicador fixo inflava
                # em até 25% uma cobrança a cada 38 dias (~9,6 vezes por ano).
                annualized_cents=round(latest.amount * (365 / median_interval)),
                confirmed=len(charges) >= 3,
            )
        )

    return sorted(recurrences, key=lambda r: -r.annualized_cents)
