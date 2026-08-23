"""O histórico de um conceito — porta de `agent/tools/read_concept_history.ts`.

`save_concept` sempre prometeu: "reverter é escrever de volta um corpo
antigo". Esta é a metade que faltava: sem um leitor, `concept_revisions`
era append-only sem forma de ver o corpo antigo para escrevê-lo de volta.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Bundle, Concept, ConceptRevision
from clara.tools.errors import ToolError, not_found

LIMIT = 20

REVERT_HINT = (
    "Para reverter: chame save_concept com o MESMO concept_id e o body/title da revisão "
    "escolhida, explicando no reason que é uma reversão. Vira revisão nova; nada é apagado."
)


@dataclass(frozen=True)
class RevisionSummary:
    revision_id: str
    author: str
    reason: str | None
    created_at: str
    title: str | None
    body: str
    current: bool = False


@dataclass(frozen=True)
class ConceptHistoryResult:
    concept_id: str
    bundle: Bundle
    type: str
    count: int
    revisions: list[RevisionSummary] = field(default_factory=list)
    truncated: bool = False
    note: str | None = None
    revert: str = REVERT_HINT


def read_concept_history(
    session: Session,
    tenant_id: str,
    *,
    concept_id: str,
    bundle: Bundle = "learnings",
    limit: int = LIMIT,
) -> ConceptHistoryResult | ToolError:
    # As revisões apontam para a ROW do conceito, não para o caminho OKF — o
    # caminho pode ser reusado após um descarte, a row não.
    concept = session.execute(
        select(Concept).where(
            Concept.tenant_id == tenant_id,
            Concept.bundle == bundle,
            Concept.concept_id == concept_id,
        )
    ).scalar_one_or_none()

    if concept is None:
        return not_found(
            "conceito_nao_encontrado",
            f"Nenhum conceito '{concept_id}' no bundle {bundle}.",
            hint="Liste os conceitos com read_concept (prefix ou concept_type) para achar o "
            "caminho certo.",
        )

    rows = (
        session.execute(
            select(ConceptRevision)
            .where(
                ConceptRevision.tenant_id == tenant_id,
                ConceptRevision.concept_row_id == concept.id,
            )
            .order_by(ConceptRevision.created_at.desc())
            .limit(limit + 1)
        )
        .scalars()
        .all()
    )

    truncated = len(rows) > limit
    page = rows[:limit] if truncated else rows

    return ConceptHistoryResult(
        concept_id=concept_id,
        bundle=bundle,
        type=concept.type,
        count=len(page),
        truncated=truncated,
        note=f"Mostrando as {limit} revisões mais recentes; há mais." if truncated else None,
        revisions=[
            RevisionSummary(
                revision_id=row.id,
                # A mais recente É o estado atual: toda escrita de
                # save_concept grava a revisão junto.
                current=(index == 0),
                author=row.author,
                reason=row.reason,
                created_at=row.created_at.isoformat(),
                title=row.frontmatter.get("title") if row.frontmatter else None,
                body=row.body,
            )
            for index, row in enumerate(page)
        ],
    )
