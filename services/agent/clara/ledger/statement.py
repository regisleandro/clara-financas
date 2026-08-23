"""Prova de extrato: saldo inicial menos movimentações = saldo final.

Porta de `statement.ts`. Diferente da fatura: extrato não tem um total
declarado a bater, tem um saldo. Saída positiva, entrada negativa — mesma
convenção do razão.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from clara.ledger.types import TransactionLike


@dataclass
class StatementBalanceReport:
    kind: Literal["statement_balance"]
    result: Literal["match", "mismatch", "insufficient_data"]
    opening_balance: int | None
    closing_balance: int | None
    net_movement: int
    expected_closing_balance: int | None
    difference: int | None


def verify_statement_balance(
    transactions: list[TransactionLike],
    opening_balance: int | None,
    closing_balance: int | None,
) -> StatementBalanceReport:
    net_movement = sum(t["amount"] for t in transactions)

    if opening_balance is None or closing_balance is None:
        return StatementBalanceReport(
            kind="statement_balance",
            result="insufficient_data",
            opening_balance=opening_balance,
            closing_balance=closing_balance,
            net_movement=net_movement,
            expected_closing_balance=None,
            difference=None,
        )

    expected_closing_balance = opening_balance - net_movement
    difference = expected_closing_balance - closing_balance
    return StatementBalanceReport(
        kind="statement_balance",
        result="match" if difference == 0 else "mismatch",
        opening_balance=opening_balance,
        closing_balance=closing_balance,
        net_movement=net_movement,
        expected_closing_balance=expected_closing_balance,
        difference=difference,
    )
