"""O consentimento de proatividade — porta de `agent/lib/proactivity.ts`.

O princípio do produto diz "proatividade depende de relevância E
consentimento". Cada compromisso individual sempre passa por aprovação — o
que faltava era o interruptor geral. O estado vive num CONCEITO do bundle
`learnings` — dado do próprio tenant, atrás da RLS, com trilha de revisões —
e não numa coluna do registro de tenants: uma preferência da pessoa é
conteúdo, não mapa. Ausência de conceito = ligado, porque tudo que já
dispara aviso hoje foi individualmente aprovado num cartão.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Concept

PROACTIVITY_CONCEPT_ID = "preferences/proactivity"


def proactivity_enabled(session: Session, tenant_id: str) -> bool:
    frontmatter = session.execute(
        select(Concept.frontmatter).where(
            Concept.tenant_id == tenant_id,
            Concept.bundle == "learnings",
            Concept.concept_id == PROACTIVITY_CONCEPT_ID,
        )
    ).scalar_one_or_none()

    return frontmatter is None or frontmatter.get("enabled") is not False
