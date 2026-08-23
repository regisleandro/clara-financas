"""A porta de saída do lembrete — porta de `agent/tools/deactivate_commitment.ts`.

Passa pelo gate pelo mesmo motivo de `save_commitment`: falar primeiro (e
parar de falar) é uma autorização da pessoa, não uma inferência da Clara.
A varredura filtra `active = "yes"`, então gravar "no" basta para calar o
aviso — sem apagar o histórico do compromisso.

Atenção ao caminho de volta: o upsert de `save_commitment` REATIVA um
compromisso do mesmo (kind, counterparty) — a Clara não deve recriar por
conta própria um lembrete que a pessoa acabou de desligar.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Commitment
from clara.tools.errors import ToolError, not_found


@dataclass(frozen=True)
class DeactivateCommitmentResult:
    commitment_id: str
    title: str
    active: Literal["no"]
    already_inactive: bool = False
    note: str | None = None


def deactivate_commitment(
    session: Session, tenant_id: str, commitment_id: str
) -> DeactivateCommitmentResult | ToolError:
    commitment = session.execute(
        select(Commitment).where(
            Commitment.id == commitment_id, Commitment.tenant_id == tenant_id
        )
    ).scalar_one_or_none()

    if commitment is None:
        return not_found(
            "compromisso_nao_encontrado",
            f"Nenhum compromisso com o id {commitment_id}.",
            hint="Chame list_commitments para pegar o id certo.",
        )

    # Idempotência: aprovar duas vezes (replay do passo durável) não pode
    # virar erro — desligado continua desligado.
    if commitment.active == "no":
        return DeactivateCommitmentResult(
            commitment_id=commitment.id, title=commitment.title, active="no", already_inactive=True
        )

    commitment.active = "no"
    session.flush()

    return DeactivateCommitmentResult(
        commitment_id=commitment.id,
        title=commitment.title,
        active="no",
        note="A Clara para de avisar sobre este vencimento. O histórico fica; reativar é salvar "
        "o compromisso de novo, com aprovação.",
    )
