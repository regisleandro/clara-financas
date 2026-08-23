"""A conferência: soma extraída contra o total declarado. Porta de `checksum.ts`.

É o diferencial do domínio — o documento carrega a própria prova. Bateu, a
extração está validada matematicamente, não por confiança no modelo. Divergiu,
há um diagnóstico: quanto falta e onde provavelmente está.

Sem tolerância por padrão, de propósito: dinheiro bate ao centavo. Uma
tolerância "só para arredondar" é como erro de extração passa despercebido.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from clara.ledger.types import ChecksumCause, ChecksumResult, Confidence, TransactionLike

_NON_SPEND_KINDS = {"payment", "card_payment", "transfer", "income"}


def counts_toward_declared_total(transaction: TransactionLike) -> bool:
    """Pagamento da fatura anterior aparece na lista de lançamentos mas NÃO
    entra no total desta fatura — ele quita o ciclo passado. Estorno entra
    (crédito contra compra do período); encargo entra; pagamento não."""
    return transaction["kind"] not in _NON_SPEND_KINDS


@dataclass(frozen=True)
class RoundingPolicy:
    """Heurística nomeada e substituível — não um número fixo escondido no cálculo."""

    floor_cents: int = 2
    per_item_cents: float = 0.5


DEFAULT_ROUNDING = RoundingPolicy()


def rounding_tolerance(item_count: int, rounding: RoundingPolicy = DEFAULT_ROUNDING) -> int:
    """A folga, em centavos, para um documento com este número de itens."""
    import math

    return max(rounding.floor_cents, math.ceil(item_count * rounding.per_item_cents))


@dataclass
class SuspectItem:
    transaction_id: str
    reason: str
    confidence: Confidence
    amount: int
    page: int | None


@dataclass
class LocalizedIn:
    area: Literal["fees", "purchases"]
    declared: int
    extracted: int


@dataclass
class ChecksumReport:
    result: ChecksumResult
    extracted_total: int
    declared_total: int | None
    difference: int | None
    suspect_items: list[SuspectItem] = field(default_factory=list)
    likely_cause: ChecksumCause | None = None
    tolerance: dict[str, int] | None = None
    localized_in: LocalizedIn | None = None


_CONFIDENCE_RANK: dict[Confidence, int] = {"baixa": 0, "media": 1, "alta": 2}


def _classify_cause(
    difference: int, item_count: int, has_exact_match: bool, rounding: RoundingPolicy
) -> ChecksumCause:
    if has_exact_match:
        return "item"
    if abs(difference) <= rounding_tolerance(item_count, rounding):
        return "rounding"
    return "unknown"


def _rank_suspects(transactions: list[TransactionLike], difference: int) -> list[SuspectItem]:
    """1) valor exatamente a diferença primeiro; 2) menor confiança primeiro;
    3) empate por valor absoluto — erro grande importa mais."""

    def sort_key(t: TransactionLike) -> tuple[int, int, int]:
        exact = t["amount"] == difference
        return (0 if exact else 1, _CONFIDENCE_RANK[t["extraction_confidence"]], -abs(t["amount"]))

    ordered = sorted(transactions, key=sort_key)

    def reason_for(t: TransactionLike) -> str:
        if t["amount"] == difference:
            return (
                "o valor deste item é exatamente a diferença — "
                "provável leitura duplicada ou faltante"
            )
        return f"confiança {t['extraction_confidence']} na extração"

    flagged = [
        t for t in ordered
        if t["amount"] == difference or t["extraction_confidence"] != "alta"
    ]

    if flagged:
        chosen = [(t, reason_for(t)) for t in flagged]
    else:
        # Extrator seguro de tudo e ainda assim não fecha: mostra os maiores
        # valores, que são onde um erro pesa mais, em vez de lista vazia.
        chosen = [(t, "nada se destacou; este é um dos maiores valores do lote") for t in ordered]

    return [
        SuspectItem(
            transaction_id=t["id"],
            reason=reason,
            confidence=t["extraction_confidence"],
            amount=t["amount"],
            page=t.get("page"),
        )
        for t, reason in chosen[:10]
    ]


def _localize(
    declared_subtotals: dict[str, int | None] | None, counted: list[TransactionLike]
) -> LocalizedIn | None:
    """Faturas declaram subtotais no resumo. Comparar cada um com a soma das
    linhas do mesmo tipo transforma "a conta não bate" em "a conta não bate
    no IOF" — a diferença entre um alarme e um diagnóstico."""
    if not declared_subtotals:
        return None

    def sum_of(kind: str) -> int:
        return sum(t["amount"] for t in counted if t["kind"] == kind)

    fees = declared_subtotals.get("fees")
    if fees is not None:
        extracted = sum_of("fee")
        if extracted != fees:
            return LocalizedIn(area="fees", declared=fees, extracted=extracted)

    purchases = declared_subtotals.get("purchases")
    if purchases is not None:
        extracted = sum_of("purchase")
        if extracted != purchases:
            return LocalizedIn(area="purchases", declared=purchases, extracted=extracted)

    return None


def verify_checksum(
    *,
    transactions: list[TransactionLike],
    declared_total: int | None,
    declared_subtotals: dict[str, int | None] | None = None,
    tolerance_cents: int = 0,
    rounding: RoundingPolicy = DEFAULT_ROUNDING,
) -> ChecksumReport:
    counted = [t for t in transactions if counts_toward_declared_total(t)]
    extracted_total = sum(t["amount"] for t in counted)

    if declared_total is None:
        return ChecksumReport(
            result="no_declared_total",
            extracted_total=extracted_total,
            declared_total=None,
            difference=None,
        )

    difference = extracted_total - declared_total

    if abs(difference) <= tolerance_cents:
        return ChecksumReport(
            result="match",
            extracted_total=extracted_total,
            declared_total=declared_total,
            difference=difference,
        )

    exact_match = any(t["amount"] == difference for t in counted)
    likely_cause = _classify_cause(difference, len(counted), exact_match, rounding)
    localized_in = _localize(declared_subtotals, counted)

    tolerance = None
    if likely_cause == "rounding":
        tolerance = {
            "cents": rounding_tolerance(len(counted), rounding),
            "item_count": len(counted),
        }

    suspect_items = [] if likely_cause == "rounding" else _rank_suspects(counted, difference)

    return ChecksumReport(
        result="mismatch",
        extracted_total=extracted_total,
        declared_total=declared_total,
        difference=difference,
        likely_cause=likely_cause,
        tolerance=tolerance,
        localized_in=localized_in,
        suspect_items=suspect_items,
    )
