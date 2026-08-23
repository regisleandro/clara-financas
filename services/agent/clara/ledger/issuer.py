"""Identidade da operadora, na leitura. Porta de `packages/ledger/src/issuer.ts`.

`documents.issuer` é texto livre: "Nubank", "NuBank" e "nu bank" são a mesma
operadora com três grafias. Esta chave agrupa as três na visão por operadora.
"""

from __future__ import annotations

import re
import unicodedata

UNKNOWN_ISSUER = "sem-operadora"


def _hash(value: str) -> str:
    acc = 0
    for char in value:
        acc = (acc * 31 + ord(char)) % 0xFFFFFF
    return _to_base36(acc)


def _to_base36(n: int) -> str:
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    if n == 0:
        return "0"
    out = []
    while n:
        n, rem = divmod(n, 36)
        out.append(digits[rem])
    return "".join(reversed(out))


def issuer_key(issuer: str | None) -> str:
    """Chave estável derivada do nome da operadora: sem acento, sem caixa."""
    if issuer is None:
        return UNKNOWN_ISSUER

    normalized = unicodedata.normalize("NFD", issuer)
    stripped = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    slug = re.sub(r"[^a-z0-9]+", "-", stripped.lower()).strip("-")

    # Uma operadora escrita só com caracteres que o slug descarta não pode
    # colidir com "sem operadora" — isso a faria desaparecer no filtro.
    if slug == "" or slug == UNKNOWN_ISSUER:
        return f"operadora-{_hash(issuer)}"
    return slug
