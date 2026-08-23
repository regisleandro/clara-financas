"""O interruptor geral dos avisos automáticos — porta de
`agent/tools/set_proactivity.ts`.

`deactivate_commitment` desliga UM lembrete; isto desliga a varredura inteira
para esta pessoa. É a metade consentimento do princípio de proatividade.
Passa pelo gate nas duas direções: desligar silencia avisos que a pessoa
aprovou um a um, e religar autoriza a Clara a falar primeiro de novo.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Concept, ConceptRevision
from clara.knowledge.proactivity import PROACTIVITY_CONCEPT_ID


@dataclass(frozen=True)
class SetProactivityResult:
    proactivity: Literal["on", "off"]
    note: str


def set_proactivity(
    session: Session, tenant_id: str, user_id: str, *, enabled: bool, reason: str | None = None
) -> SetProactivityResult:
    now_iso = datetime.now(UTC).isoformat()
    frontmatter = {
        "type": "Preference",
        "title": "Proatividade",
        "enabled": enabled,
        "verified": [{"by": f"human:{user_id}", "at": now_iso}],
    }
    body = (
        "Avisos automáticos ligados: a varredura diária de vencimentos pode avisar."
        if enabled
        else "Avisos automáticos desligados: a varredura diária de vencimentos não avisa nada."
    )

    existing = session.execute(
        select(Concept).where(
            Concept.tenant_id == tenant_id,
            Concept.bundle == "learnings",
            Concept.concept_id == PROACTIVITY_CONCEPT_ID,
        )
    ).scalar_one_or_none()

    if existing is not None:
        existing.frontmatter = frontmatter
        existing.body = body
        row_id = existing.id
    else:
        concept = Concept(
            tenant_id=tenant_id,
            bundle="learnings",
            concept_id=PROACTIVITY_CONCEPT_ID,
            type="Preference",
            frontmatter=frontmatter,
            body=body,
        )
        session.add(concept)
        session.flush()
        row_id = concept.id

    # A trilha conta quem mudou o interruptor, quando e por quê — a mesma
    # disciplina de todo aprendizado.
    session.add(
        ConceptRevision(
            tenant_id=tenant_id,
            concept_row_id=row_id,
            author=f"human:{user_id}",
            reason=reason or ("avisos religados" if enabled else "avisos desligados"),
            frontmatter=frontmatter,
            body=body,
        )
    )
    session.flush()

    return SetProactivityResult(
        proactivity="on" if enabled else "off",
        note=(
            "A varredura diária volta a avisar sobre os compromissos ativos."
            if enabled
            else "Nenhum aviso automático sai mais. Os compromissos continuam guardados; os "
            "vencimentos seguem visíveis na agenda."
        ),
    )
