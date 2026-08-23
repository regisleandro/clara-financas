"""O SEGUNDO GATE: escrita na memória semântica — porta de
`agent/tools/save_concept.ts`.

É aqui que a hipótese H4 se realiza — o sistema aprende, mas cada aprendizado
é um conceito legível, versionado e reversível, e nenhum entra sem a pessoa
aprovar. Três invariantes que a função garante, não o modelo:

1. Só escreve no bundle `learnings`. A constituição é contrato, alterada por
   edição direta no repositório — nunca pela conversa.
2. Toda escrita insere uma revisão em `concept_revisions`, append-only.
3. `verified: [{"by": "human:<user_id>"}]` carimba quem aprovou, na convenção
   de ator do OKF §7 — a prova de que o gate foi honrado.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Concept, ConceptRevision
from clara.tools.errors import ToolError, tool_error

AGENT_ACTOR = "clara/coordinator@0.1"

# `Category` está aqui de propósito: a constituição semeia uma taxonomia
# inicial, mas gasto é pessoal — quem tem animal precisa de Pets, quem não
# tem, não. `MerchantAlias` cobre o que a normalização determinística recusa
# a chutar: identidade de comerciante é conhecimento sobre o mundo, e
# adivinhar produziria fusão errada silenciosa.
LEARNED_TYPES = (
    "Category",
    "Merchant",
    "MerchantAlias",
    "CategorizationRule",
    "Commitment",
    "IssuerPattern",
)
LearnedType = Literal[
    "Category", "Merchant", "MerchantAlias", "CategorizationRule", "Commitment", "IssuerPattern"
]


@dataclass(frozen=True)
class SaveConceptResult:
    concept_id: str
    bundle: Literal["learnings"]
    action: Literal["created", "updated"]
    verified_by: str


def save_concept(
    session: Session,
    tenant_id: str,
    user_id: str,
    *,
    concept_id: str,
    concept_type: LearnedType,
    title: str,
    body: str,
    description: str | None = None,
    merchant: str | None = None,
    aliases: list[str] | None = None,
    reason: str | None = None,
) -> SaveConceptResult | ToolError:
    if concept_type == "CategorizationRule" and merchant is None:
        return tool_error(
            "recorte_incompleto",
            "CategorizationRule exige merchant.",
            hint="Informe o trecho estável do comerciante, em minúsculas.",
        )
    if concept_type == "MerchantAlias" and not aliases:
        return tool_error(
            "recorte_incompleto",
            "MerchantAlias exige pelo menos duas grafias.",
            hint="Informe aliases com as grafias comprovadamente da mesma empresa.",
        )

    now_iso = datetime.now(UTC).isoformat()

    existing = session.execute(
        select(Concept).where(
            Concept.tenant_id == tenant_id,
            Concept.bundle == "learnings",
            Concept.concept_id == concept_id,
        )
    ).scalar_one_or_none()

    previous_verified = existing.frontmatter.get("verified", []) if existing is not None else []
    frontmatter: dict[str, object] = {
        "type": concept_type,
        "title": title,
        "status": "stable",
        "generated": {"by": AGENT_ACTOR, "at": now_iso},
        # Convenção de ator do OKF §7 — a prova de que uma pessoa aprovou.
        "verified": [*previous_verified, {"by": f"human:{user_id}", "at": now_iso}],
    }
    if description is not None:
        frontmatter["description"] = description
    if merchant is not None:
        frontmatter["merchant"] = merchant
    if aliases is not None:
        frontmatter["aliases"] = aliases

    action: Literal["created", "updated"]
    if existing is not None:
        existing.type = concept_type
        existing.frontmatter = frontmatter
        existing.body = body
        row_id = existing.id
        action = "updated"
    else:
        concept = Concept(
            tenant_id=tenant_id,
            bundle="learnings",
            concept_id=concept_id,
            type=concept_type,
            frontmatter=frontmatter,
            body=body,
        )
        session.add(concept)
        session.flush()
        row_id = concept.id
        action = "created"

    # A revisão registra o estado NOVO. Como a tabela é append-only, o
    # histórico completo é a sequência delas — e reverter é escrever de volta
    # um corpo antigo, nunca apagar.
    session.add(
        ConceptRevision(
            tenant_id=tenant_id,
            concept_row_id=row_id,
            author=f"human:{user_id}",
            reason=reason or ("conceito atualizado" if action == "updated" else "conceito criado"),
            frontmatter=frontmatter,
            body=body,
        )
    )
    session.flush()

    return SaveConceptResult(
        concept_id=concept_id, bundle="learnings", action=action, verified_by=f"human:{user_id}"
    )
