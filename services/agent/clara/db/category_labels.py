"""Carrega o mapa slug → título em português das categorias do tenant.

Porta de `packages/db/src/category-labels.ts`. Agente e web precisam do
mesmo mapa — sem isso o dashboard mostra "dining" enquanto a conversa diz
"Restaurantes".
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Concept
from clara.ledger.categories import category_slug


def load_category_labels(session: Session, tenant_id: str) -> dict[str, str]:
    rows = session.execute(
        select(Concept.concept_id, Concept.frontmatter).where(
            Concept.tenant_id == tenant_id, Concept.type == "Category"
        )
    ).all()

    labels: dict[str, str] = {}
    for concept_id, frontmatter in rows:
        title = (frontmatter or {}).get("title")
        if isinstance(title, str) and title:
            labels[category_slug(concept_id)] = title
    return labels
