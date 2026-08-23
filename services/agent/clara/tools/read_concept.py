"""Lê conceitos OKF do espaço do usuário — porta de `agent/tools/read_concept.ts`.

Leitura pura, sem gate: consulta categorias, convenções e regras da
constituição, ou o que já foi aprendido sobre a pessoa.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Bundle, Concept

# O que passa disso é anunciado, nunca cortado calado.
LIMIT = 50


@dataclass(frozen=True)
class ConceptSummary:
    id: str
    type: str
    title: str | None
    description: str | None
    body: str | None = None


@dataclass(frozen=True)
class ReadConceptResult:
    bundle: Bundle
    count: int
    concepts: list[ConceptSummary] = field(default_factory=list)
    truncated: bool = False
    note: str | None = None


def read_concept(
    session: Session,
    tenant_id: str,
    *,
    bundle: Bundle,
    concept_id: str | None = None,
    concept_type: str | None = None,
    prefix: str | None = None,
) -> ReadConceptResult:
    conditions = [Concept.tenant_id == tenant_id, Concept.bundle == bundle]
    if concept_id is not None:
        conditions.append(Concept.concept_id == concept_id)
    if concept_type is not None:
        conditions.append(Concept.type == concept_type)
    if prefix is not None:
        conditions.append(Concept.concept_id.like(f"{prefix}%"))

    # Pede um a mais que o teto só para saber se havia mais.
    rows = (
        session.execute(
            select(Concept).where(*conditions).order_by(Concept.concept_id).limit(LIMIT + 1)
        )
        .scalars()
        .all()
    )

    truncated = len(rows) > LIMIT
    page = rows[:LIMIT] if truncated else rows
    # Numa listagem o corpo inteiro é ruído; num conceito específico é a
    # resposta.
    is_single = concept_id is not None

    return ReadConceptResult(
        bundle=bundle,
        count=len(page),
        truncated=truncated,
        note=(
            f"Mostrando {LIMIT} conceitos; há mais. Filtre por concept_type ou prefix para ver "
            "o resto."
            if truncated
            else None
        ),
        concepts=[
            ConceptSummary(
                id=row.concept_id,
                type=row.type,
                title=row.frontmatter.get("title"),
                description=row.frontmatter.get("description"),
                body=row.body if is_single else None,
            )
            for row in page
        ],
    )
