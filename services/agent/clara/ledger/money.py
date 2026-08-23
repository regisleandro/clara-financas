"""Dinheiro é inteiro, sempre. Porta de `formatCents`/`sumAmounts` de checksum.ts.

Nenhum ponto flutuante toca em valor financeiro em lugar nenhum do caminho —
é a mesma disciplina do TypeScript original (`bigint` em centavos), só que sem
precisar de `bigint`: o `int` do Python já é arbitrariamente grande.
"""

from __future__ import annotations

from collections.abc import Iterable


def sum_amounts(amounts: Iterable[int]) -> int:
    """Soma em inteiros. Cada valor já é centavos, sinalizado."""
    return sum(amounts)


def format_cents(cents: int) -> str:
    """Formata centavos em `R$ #.###,##`. Nunca usado em cálculo, só exibição."""
    if not isinstance(cents, int):
        raise TypeError("format_cents exige um valor inteiro em centavos.")

    sign = "-" if cents < 0 else ""
    whole, frac = divmod(abs(cents), 100)
    # separador de milhar '.', decimal ',': convenção pt-BR.
    grouped = f"{whole:,}".replace(",", ".")
    return f"{sign}R$ {grouped},{frac:02d}"
