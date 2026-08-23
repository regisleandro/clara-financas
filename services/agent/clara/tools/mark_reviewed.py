"""O atestado: "uma pessoa olhou isto" — porta de `agent/tools/mark_reviewed.ts`.

Não muda nenhum dado financeiro, e é reversível na frase seguinte com
`reopen=True`. A conclusão mais comum de uma revisão é "a leitura já estava
certa", e sem gravar que alguém olhou, a fila devolveria os mesmos itens para
sempre.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.orm import Session

from clara.db.models import Transaction

# Acima deste tanto de linhas, atestar em massa esvazia a fila com uma frase
# — e ninguém revisou 500 linhas numa frase só. É o mesmo argumento de escala
# que separa uma correção direta de categoria de `recategorize_transactions`
# em lote. Reabrir nunca exige o cartão: devolver itens à fila é a direção
# segura.
NO_CARD_LIMIT = 20


@dataclass(frozen=True)
class MarkReviewedResult:
    reviewed: int
    reopened: int
    not_found: list[str] = field(default_factory=list)
    audited_by: str = ""
    note: str | None = None


def mark_reviewed(
    session: Session,
    tenant_id: str,
    user_id: str,
    transaction_ids: list[str],
    *,
    reopen: bool = False,
) -> MarkReviewedResult:
    values = (
        {"reviewed_at": None, "reviewed_by": None}
        if reopen
        else {"reviewed_at": datetime.now(UTC), "reviewed_by": f"human:{user_id}"}
    )
    touched = (
        session.execute(
            update(Transaction)
            .where(
                Transaction.tenant_id == tenant_id,
                Transaction.id.in_(transaction_ids),
                # Rascunho não se atesta: ainda vai passar pela decisão do lote
                # inteiro, que é uma conferência mais forte que esta.
                Transaction.status.in_(["confirmed", "adjustment"]),
            )
            .values(**values)
            .returning(Transaction.id)
        )
        .scalars()
        .all()
    )

    done = set(touched)
    missed = [t for t in transaction_ids if t not in done]

    return MarkReviewedResult(
        reviewed=0 if reopen else len(touched),
        reopened=len(touched) if reopen else 0,
        not_found=missed,
        audited_by=f"human:{user_id}",
        note=(
            "Ids em not_found não existem OU ainda estão em lote proposto, onde a revisão é a "
            "decisão do lote."
            if missed
            else None
        ),
    )
