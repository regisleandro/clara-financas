"""As categorias que existem para esta pessoa — porta de `agent/lib/category-scope.ts`.

Vem dos DOIS bundles: a constituição semeia a taxonomia inicial e o que a
pessoa aprovou depois vale igual.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Concept
from clara.ledger.categories import category_slug
from clara.tools.errors import ToolError, refused


def load_valid_categories(session: Session, tenant_id: str) -> set[str]:
    rows = session.execute(
        select(Concept.concept_id).where(Concept.tenant_id == tenant_id, Concept.type == "Category")
    ).scalars().all()
    return {category_slug(row) for row in rows}


def unknown_category(invalid: list[str], valid: set[str]) -> ToolError:
    """Recusa uma categoria que não existe — dizendo como criá-la.

    "Entre uma categoria errada e nenhuma, deixe nenhuma": a recusa não
    empurra para a menos errada da lista válida, aponta para `save_concept`.
    """
    names = ", ".join(f'"{name}"' for name in invalid)
    suggestion = invalid[0] if invalid else None
    hint = (
        "Use uma das categorias válidas."
        if suggestion is None
        else (
            f'Ou use uma das válidas, ou proponha a criação com save_concept '
            f'(type "Category", conceptId "categories/{suggestion}") e recategorize '
            "depois de aprovada. Entre uma categoria errada e nenhuma, deixe nenhuma."
        )
    )
    message = f"Não existe categoria {names} para esta pessoa."
    return refused("categoria_desconhecida", message, hint=hint)
