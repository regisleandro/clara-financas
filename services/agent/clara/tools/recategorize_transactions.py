"""Reclassifica transações já confirmadas — porta de
`agent/tools/recategorize_transactions.ts` (só o caminho de mudança direta;
o caminho por artefato do categorizador fica para quando ele existir).

Passa pelo gate porque muda o SENTIDO do razão: toda análise por categoria
enxerga outra coisa depois disto. Não muda os fatos — valor, data, descrição
e origem seguem intocáveis, garantido pelo trigger do banco. Cada mudança
grava uma linha em `transaction_reclassifications`, append-only: reclassificar
é permitido; reclassificar em silêncio, não.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Transaction, TransactionReclassification
from clara.ledger.categories import category_slug
from clara.tools.category_scope import load_valid_categories, unknown_category
from clara.tools.errors import ToolError, tool_error


@dataclass(frozen=True)
class CategoryChange:
    transaction_id: str
    category: str
    category_label: str


@dataclass(frozen=True)
class RecategorizeResult:
    changed: int
    unchanged: int
    not_found: list[str] = field(default_factory=list)
    audited_by: str = ""
    note: str | None = None


def recategorize_transactions(
    session: Session,
    tenant_id: str,
    user_id: str,
    changes: list[CategoryChange],
    *,
    reason: str | None = None,
    by_concept_id: str | None = None,
) -> RecategorizeResult | ToolError:
    valid = load_valid_categories(session, tenant_id)
    normalized = [
        CategoryChange(c.transaction_id, category_slug(c.category), c.category_label)
        for c in changes
    ]
    invalid = sorted({c.category for c in normalized if c.category not in valid})
    if invalid:
        return unknown_category(invalid, valid)

    ids = [c.transaction_id for c in normalized]
    # Só transações do razão de verdade: um lote ainda `proposed` se corrige
    # com `edit_proposed_batch`, não por aqui — reclassificar um rascunho
    # gravaria trilha de auditoria para algo que a pessoa ainda nem confirmou.
    rows = session.execute(
        select(Transaction.id, Transaction.category).where(
            Transaction.tenant_id == tenant_id,
            Transaction.id.in_(ids),
            Transaction.status.in_(["confirmed", "adjustment"]),
        )
    ).all()
    current_by_id: dict[str, str | None] = {row.id: row.category for row in rows}

    changed = 0
    unchanged = 0
    not_found: list[str] = []

    for change in normalized:
        if change.transaction_id not in current_by_id:
            not_found.append(change.transaction_id)
            continue

        previous = current_by_id[change.transaction_id]
        if previous == change.category:
            unchanged += 1
            continue

        transaction = session.get(Transaction, change.transaction_id)
        assert transaction is not None
        transaction.category = change.category

        session.add(
            TransactionReclassification(
                id=f"reclass_{uuid.uuid4().hex[:20]}",
                tenant_id=tenant_id,
                transaction_id=change.transaction_id,
                field="category",
                previous_value=previous,
                new_value=change.category,
                author=f"human:{user_id}",
                reason=reason,
                by_concept_id=by_concept_id,
            )
        )
        changed += 1

    session.flush()

    # Zero mudanças depois de um SIM no cartão não é sucesso: a pessoa
    # aprovou algo e nada aconteceu. Erro estruturado obriga a explicar, em
    # vez de um `{changed: 0}` mudo, indistinguível de aprovação que mudou tudo.
    if changed == 0:
        hint = (
            "Ids em not_found não existem ou ainda estão em lote proposto. Rascunho se corrige "
            "com edit_proposed_batch; confira os ids com read_batch ou com as ferramentas do "
            "analista."
            if not_found
            else "Todas as linhas já estavam na categoria pedida. Diga isso à pessoa em vez de "
            "anunciar uma mudança."
        )
        return tool_error(
            "nenhuma_alteracao",
            "Nenhuma categoria foi alterada — a aprovação não teve efeito.",
            hint=hint,
        )

    return RecategorizeResult(
        changed=changed,
        unchanged=unchanged,
        not_found=not_found,
        audited_by=f"human:{user_id}",
        note=(
            "Ids em not_found não existem OU ainda estão em lote proposto — rascunho se corrige "
            "com edit_proposed_batch."
            if not_found
            else None
        ),
    )
