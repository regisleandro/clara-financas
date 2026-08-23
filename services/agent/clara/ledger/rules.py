"""Regras de categorização aprendidas — porta de `packages/ledger/src/rules.ts`.

Decidir a categoria de um lançamento é decisão de domínio: precisa ser pura,
determinística e testável. Uma regra que categoriza errado é indistinguível
de um número errado — contamina toda análise que vier depois.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# O corpo referencia a categoria por link markdown ABSOLUTO — é a sintaxe de
# cross-link do OKF (§6.1), não invenção nossa.
_CATEGORY_LINK = re.compile(r"\]\(/categories/([a-z0-9-]+)\.md\)")


@dataclass(frozen=True)
class RuleCandidate:
    concept_id: str
    frontmatter: dict[str, object]
    body: str


@dataclass(frozen=True)
class LearnedRule:
    concept_id: str
    # Trecho estável que identifica o lançamento, em minúsculas.
    matcher: str
    category: str


@dataclass(frozen=True)
class RuleTarget:
    id: str
    merchant: str | None
    original_description: str


@dataclass(frozen=True)
class RuleMatch:
    transaction_id: str
    description: str
    category: str
    by_concept_id: str


def parse_rules(candidates: list[RuleCandidate]) -> list[LearnedRule]:
    """Converte conceitos crus em regras aplicáveis. Conceito malformado é
    descartado em silêncio, não derruba o lote: o OKF manda tolerar link
    quebrado (§11), e uma regra ruim não pode impedir as boas de rodarem."""
    rules: list[LearnedRule] = []
    for candidate in candidates:
        raw = candidate.frontmatter.get("merchant") or candidate.frontmatter.get("title")
        link = _CATEGORY_LINK.search(candidate.body)
        if not isinstance(raw, str) or link is None:
            continue

        matcher = raw.strip().lower()
        if matcher == "":
            continue

        rules.append(
            LearnedRule(concept_id=candidate.concept_id, matcher=matcher, category=link.group(1))
        )
    return rules


def match_rules(rules: list[LearnedRule], targets: list[RuleTarget]) -> list[RuleMatch]:
    """Casa regras contra lançamentos. Primeira regra que casa vence — e por
    isso a ordem importa: regras mais específicas devem vir antes. Não há
    ranking por "melhor casamento" de propósito; escolha implícita entre duas
    regras que ambas casam não é auditável."""
    matches: list[RuleMatch] = []
    for target in targets:
        haystack = f"{target.merchant or ''} {target.original_description}".lower()
        rule = next((candidate for candidate in rules if candidate.matcher in haystack), None)
        if rule is None:
            continue

        matches.append(
            RuleMatch(
                transaction_id=target.id,
                description=target.merchant or target.original_description,
                category=rule.category,
                by_concept_id=rule.concept_id,
            )
        )
    return matches
