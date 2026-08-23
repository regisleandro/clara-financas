"""Aplica as regras já aprendidas às transações sem categoria — porta de
`agent/tools/apply_learned_rules.ts`.

É a peça que FECHA o ciclo da hipótese H4: sem ela, o sistema podia aprender
uma regra e nunca usá-la. Aprendizado que não se aplica não é aprendizado —
é anotação.

Agno não tem confirmação condicional por argumento, então o caminho `dryRun`
do original vira uma tool ungated à parte (`apply_learned_rules_preview`);
o caminho de escrita continua gated, porque muda o SENTIDO do razão. A
natureza da decisão é diferente da primeira aprovação de categoria: aqui a
pessoa já disse "sempre categorize assim" — o que ela aprova agora é o
ALCANCE, verificado batendo `expected_transaction_ids` contra a simulação
mais recente.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Concept, Transaction, TransactionReclassification
from clara.ledger.rules import RuleCandidate, RuleMatch, RuleTarget, match_rules, parse_rules
from clara.tools.errors import ToolError, tool_error


@dataclass(frozen=True)
class EmptyRulesResult:
    empty: bool
    message: str


@dataclass(frozen=True)
class PreviewResult:
    dry_run: bool
    rules_loaded: int
    uncategorized_count: int
    would_apply: int
    matches: list[RuleMatch] = field(default_factory=list)
    transaction_ids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ApplyLearnedRulesResult:
    rules_loaded: int
    applied: int
    remaining_uncategorized: int
    audited_by: str


def _load_matches(
    session: Session, tenant_id: str
) -> tuple[list[RuleMatch], int, int] | EmptyRulesResult:
    rows = session.execute(
        select(Concept.concept_id, Concept.frontmatter, Concept.body).where(
            Concept.tenant_id == tenant_id,
            Concept.bundle == "learnings",
            Concept.type == "CategorizationRule",
        )
    ).all()

    if not rows:
        return EmptyRulesResult(
            empty=True,
            message="Nenhuma regra foi aprendida ainda. Uma regra nasce quando a pessoa corrige "
            "uma categoria e aprova manter a correção.",
        )

    parsed = parse_rules(
        [
            RuleCandidate(concept_id=r.concept_id, frontmatter=r.frontmatter, body=r.body)
            for r in rows
        ]
    )
    if not parsed:
        return EmptyRulesResult(
            empty=True,
            message="As regras existentes não apontam para uma categoria válida. Uma regra "
            "precisa referenciar a categoria por link, ex.: [Assinaturas](/categories/"
            "subscriptions.md).",
        )

    uncategorized = session.execute(
        select(Transaction.id, Transaction.merchant, Transaction.original_description).where(
            Transaction.tenant_id == tenant_id,
            Transaction.category.is_(None),
            Transaction.status.in_(["confirmed", "adjustment"]),
        )
    ).all()

    targets = [
        RuleTarget(id=row.id, merchant=row.merchant, original_description=row.original_description)
        for row in uncategorized
    ]
    return match_rules(parsed, targets), len(uncategorized), len(parsed)


def preview_learned_rules(session: Session, tenant_id: str) -> PreviewResult | EmptyRulesResult:
    loaded = _load_matches(session, tenant_id)
    if isinstance(loaded, EmptyRulesResult):
        return loaded
    matches, uncategorized_count, rules_loaded = loaded

    return PreviewResult(
        dry_run=True,
        rules_loaded=rules_loaded,
        uncategorized_count=uncategorized_count,
        would_apply=len(matches),
        matches=matches[:20],
        transaction_ids=[m.transaction_id for m in matches],
    )


def apply_learned_rules(
    session: Session,
    tenant_id: str,
    user_id: str,
    *,
    expected_transaction_ids: list[str],
) -> ApplyLearnedRulesResult | EmptyRulesResult | ToolError:
    loaded = _load_matches(session, tenant_id)
    if isinstance(loaded, EmptyRulesResult):
        return loaded
    matches, uncategorized_count, rules_loaded = loaded

    expected = sorted(expected_transaction_ids)
    actual = sorted(m.transaction_id for m in matches)
    if not expected or expected != actual:
        # Recuperável POR DESENHO: o guard recusando é o sistema funcionando.
        return tool_error(
            "alcance_alterado",
            "O alcance da regra mudou desde a simulação — nada foi aplicado.",
            hint="Chame apply_learned_rules_preview de novo e abra uma nova decisão com os ids "
            "atuais.",
        )

    for match in matches:
        transaction = session.get(Transaction, match.transaction_id)
        assert transaction is not None
        transaction.category = match.category

        session.add(
            TransactionReclassification(
                id=f"reclass_{uuid.uuid4().hex[:20]}",
                tenant_id=tenant_id,
                transaction_id=match.transaction_id,
                field="category",
                previous_value=None,
                new_value=match.category,
                author=f"human:{user_id}",
                reason="regra aprendida aplicada",
                by_concept_id=match.by_concept_id,
            )
        )

    session.flush()

    return ApplyLearnedRulesResult(
        rules_loaded=rules_loaded,
        applied=len(matches),
        remaining_uncategorized=uncategorized_count - len(matches),
        audited_by=f"human:{user_id}",
    )
