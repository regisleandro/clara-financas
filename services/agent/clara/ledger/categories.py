"""Tradução de identificador de categoria para o nome que a pessoa lê.

Porta de `packages/ledger/src/categories.ts`. O identificador é inglês por
decisão de projeto; o nome em português vem do `title` do conceito.
"""

from __future__ import annotations


def category_slug(concept_id: str) -> str:
    """O id do conceito OKF é o caminho no bundle (`categories/groceries`); o
    razão guarda só o slug (`groceries`). Aceita as duas formas — a origem do
    dado não deve decidir se a tradução funciona."""
    prefix = "categories/"
    return concept_id[len(prefix):] if concept_id.startswith(prefix) else concept_id


def category_label(labels: dict[str, str], category: str | None) -> str:
    """Aplica o rótulo, com queda para o próprio identificador."""
    if category is None:
        return "Sem categoria"
    slug = category_slug(category)
    return labels.get(slug) or labels.get(category) or category
