"""A natureza da linha, em português. Porta de `entry-kind.ts`.

`kind` é identificador interno; a pessoa lê o rótulo, nunca o slug — a mesma
regra que vale para categoria.
"""

from __future__ import annotations

from clara.ledger.checksum import counts_toward_declared_total
from clara.ledger.types import EntryKind, TransactionLike

_LABELS: dict[EntryKind, tuple[str, str]] = {
    "purchase": ("Compra", "Compras"),
    "payment": ("Pagamento de fatura", "Pagamentos de fatura"),
    "refund": ("Estorno", "Estornos"),
    "fee": ("Encargo", "Encargos"),
    "adjustment": ("Ajuste", "Ajustes"),
    "income": ("Entrada", "Entradas"),
    "transfer": ("Transferência", "Transferências"),
    "card_payment": ("Pagamento com cartão", "Pagamentos com cartão"),
    "cash_withdrawal": ("Saque", "Saques"),
}


def entry_kind_label(kind: EntryKind) -> str:
    return _LABELS[kind][0]


def entry_kind_label_plural(kind: EntryKind) -> str:
    """O plural vem de uma tabela, não de `+ 's'` — português não pluraliza
    por sufixo único ("Pagamento com cartão" não vira "cartãos")."""
    return _LABELS[kind][1]


def non_spend_label(transactions: list[TransactionLike]) -> str:
    """Como chamar um conjunto de lançamentos que NÃO são gasto.

    Derivado do que ESTÁ no recorte — sem lista de exceções a manter em dia.
    """
    kinds = {t["kind"] for t in transactions}
    if not kinds:
        return "Lançamentos"
    if len(kinds) == 1:
        return entry_kind_label_plural(next(iter(kinds)))
    return "Lançamentos que não são gasto"


def has_no_spend(transactions: list[TransactionLike]) -> bool:
    """Nenhuma linha do recorte conta como gasto — o total de gasto seria zero."""
    return not any(counts_toward_declared_total(t) for t in transactions)
