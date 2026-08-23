"""Identidade do comerciante, separada do texto que o documento imprimiu.

Porta de `merchant.ts`. O extrator é isolado do razão por construção — não vê
o que já foi registrado, então normaliza cada documento do zero. Duas faturas
reais do mesmo cartão produziram:

    maio:  "•••• 4851 Claude.Ai Subscription BRL 110.00 = USD 22.24 …"
    junho: "Anthropic* Claude Sub"

Nenhuma análise que agrupe pelo texto cru sobrevive a isso. Este módulo
resolve a parte MECÂNICA — máscara de cartão, parcela, câmbio, IOF, prefixo de
intermediário — e é determinístico. O que ele deliberadamente NÃO faz é
adivinhar que "Anthropic" e "Claude.Ai Subscription" são a mesma empresa: isso
é conhecimento sobre o mundo, não sobre a string, e o lugar dele é o ciclo de
aprendizado (`MerchantAlias`, aprovado pela pessoa). Chutar aqui produz fusões
erradas silenciosas — o pior defeito possível numa análise financeira.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable

_CARD_MASK = re.compile(r"^[•*·.\s]{2,}\s*\d{4}\s*")
_INSTALLMENT = re.compile(r"\s*[-–—]?\s*(parcela\s*)?\d{1,2}\s*/\s*\d{1,2}\s*$", re.IGNORECASE)
# Estrutural, não uma lista fixa de moedas: três letras seguidas de um valor
# com centavos é código de moeda mais valor, qualquer que seja a moeda.
_FX_TAIL = re.compile(r"\s+[a-z]{3}\s*\d[\d.]*[.,]\d{2}\b.*$", re.IGNORECASE)
_FX_CONVERSION = re.compile(r"\s*convers[ãa]o\s*:.*$", re.IGNORECASE)
_IOF_WRAPPER = re.compile(
    r'^iof\s+(de|sobre)\s*["“”\']?\s*(?P<inner>.+?)\s*["“”\']?\s*$', re.IGNORECASE
)
# Posicional: o que vem antes do primeiro `*` é sempre roteamento do
# intermediário (Dl*Google Medium, Mp *Melimais) — uma lista fechada de
# adquirentes sempre ficaria atrás da realidade.
_GATEWAY_PREFIX = re.compile(r"^[a-z0-9]{1,15}\s*\*+\s*(?=\S)", re.IGNORECASE)

# Meios de pagamento e bandeiras — vocabulário estável do domínio, ao
# contrário de nomes de loja. Uma regra posicional comeria nomes como
# "Mercado - Pix", por isso continua sendo lista.
_PAYMENT_RAILS = (
    "nupay", "nubank", "pix", "debito", "credito", "avista", "parcelado",
    "visa", "master", "mastercard", "elo", "amex", "hiper", "maestro",
    "cielo", "rede", "stone", "getnet", "picpay", "applepay", "googlepay",
    "samsungpay",
)
_TRAILING_NOISE = re.compile(
    r"\s*[-–—*]+\s*(" + "|".join(_PAYMENT_RAILS) + r")\s*$", re.IGNORECASE
)


def merchant_key(*, original_description: str, merchant: str | None = None) -> str | None:
    """Chave canônica do comerciante, ou `None` quando não há identidade a extrair.

    Recebe a descrição original porque o invólucro do IOF só existe nela; o
    campo `merchant` do extrator já vem sujo (copia um trecho da descrição).
    """
    source = merchant.strip() if merchant and merchant.strip() else original_description
    if not isinstance(source, str) or source.strip() == "":
        return None

    text = source.strip()

    iof = _IOF_WRAPPER.match(text)
    if iof is not None:
        text = iof.group("inner")

    text = _CARD_MASK.sub("", text)
    text = _GATEWAY_PREFIX.sub("", text)
    text = _FX_CONVERSION.sub("", text)
    text = _FX_TAIL.sub("", text)
    text = _INSTALLMENT.sub("", text)
    text = _TRAILING_NOISE.sub("", text)

    normalized = unicodedata.normalize("NFD", text)
    # Diacríticos fora: o mesmo comerciante aparece com e sem acento entre faturas.
    stripped = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    key = re.sub(r"[^a-z0-9]+", " ", stripped.lower()).strip()
    key = re.sub(r"\s+", " ", key)

    return key or None


def is_truncation_of(shorter: str, longer: str) -> bool:
    """Duas chaves são o mesmo comerciante quando uma é a versão truncada da outra.

    Critério conservador: os tokens anteriores batem exatamente, e o último
    token da chave curta é PREFIXO do token correspondente da longa. Um
    último token de uma letra só é ruído de corte, não evidência — exige 2+
    tokens no total para não fundir "posto a" com "posto amarelo" por acaso.
    """
    if shorter == "" or longer == "":
        return False
    if shorter == longer:
        return True

    short_tokens = shorter.split(" ")
    long_tokens = longer.split(" ")
    if len(short_tokens) > len(long_tokens):
        return False

    for i in range(len(short_tokens) - 1):
        if short_tokens[i] != long_tokens[i]:
            return False

    last = short_tokens[-1]
    counterpart = long_tokens[len(short_tokens) - 1]

    if len(last) < 2:
        return len(short_tokens) > 2 and counterpart.startswith(last)

    return counterpart.startswith(last)


def cluster_merchant_keys(
    keys: Iterable[str], aliases: Iterable[Iterable[str]] = ()
) -> dict[str, str]:
    """Agrupa chaves equivalentes num representante comum.

    A equivalência por truncamento é resolvida na LEITURA, não gravada na
    linha: a linha confirmada é imutável, e o resultado não pode depender da
    ordem de chegada das faturas. O representante é a forma mais curta do
    grupo — o maior denominador comum entre os cortes que o emissor imprimiu.
    """
    ordered = sorted(set(keys), key=lambda k: (len(k), k))
    representatives: list[str] = []
    clustered: dict[str, str] = {}

    for key in ordered:
        found = next((rep for rep in representatives if is_truncation_of(rep, key)), None)
        if found is None:
            representatives.append(key)
            clustered[key] = key
        else:
            clustered[key] = found

    # Apelidos aprovados pela pessoa vêm DEPOIS do truncamento e fundem
    # grupos inteiros — é o que impede o conceito `MerchantAlias` de virar
    # anotação sem efeito.
    for group in aliases:
        members = [m for m in group if m in clustered]
        if len(members) < 2:
            continue

        target = sorted({clustered[m] for m in members})[0]
        absorbed = {clustered[m] for m in members}

        for key, representative in list(clustered.items()):
            if representative in absorbed:
                clustered[key] = target

    return clustered
