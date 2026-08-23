"""O GATE — porta de `agent/tools/commit_batch.ts`.

A única porta entre o rascunho e o razão. `@tool(requires_confirmation=True)`
(ver `clara/agents/coordinator.py`) estaciona o turno até uma pessoa decidir —
pode ficar pausado por dias, sem consumir compute, e retomar exatamente onde
parou (o mecanismo é do Agno: `RunRequirement`, resolvida por um `ToolMessage`
AG-UI com `{"accepted": true}`).

Dois princípios que este executor respeita:

 1. **Aprovação é gate, não autorização.** Quem aprovou só tinha acesso à
    sessão — por isso `require_tenant_caller` roda de novo aqui dentro,
    depois do sim.
 2. **A política pode mudar enquanto o turno está pausado.** Por isso a
    revisão da fatura (`entity_revision`) e o estado do lote são
    revalidados no momento da EXECUÇÃO, não no da proposta (FR-012).

A checagem de posse de sessão que o Eve original fazia aqui dentro
(`auth.current !== auth.initiator`) não é reproduzida nesta função: nesta
arquitetura ela já é imposta uma camada abaixo, na ACL de `agent_sessions`
que valida toda rota com `session_id` antes de a ferramenta ser alcançada
(FR-003) — duplicar a checagem aqui seria uma segunda fonte da mesma verdade.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from clara.db.models import Batch, FinancialActionProposal, Transaction
from clara.tools.errors import ToolError, not_found, refused


@dataclass
class CommitReceipt:
    action_id: str | None
    mutation_id: str
    batch_id: str
    status: str
    confirmed_transactions: int
    checksum_result: str | None
    revision_before: str
    can_undo: bool
    already_confirmed: bool = False


def commit_batch(
    session: Session,
    tenant_id: str,
    user_id: str,
    *,
    batch_id: str | None = None,
    proposal_id: str | None = None,
) -> CommitReceipt | ToolError:
    if batch_id is None and proposal_id is None:
        return refused("operacao_nao_permitida", "informe proposal_id ou batch_id")

    proposal: FinancialActionProposal | None = None
    if proposal_id is not None:
        proposal = session.execute(
            select(FinancialActionProposal).where(
                FinancialActionProposal.id == proposal_id,
                FinancialActionProposal.tenant_id == tenant_id,
            )
        ).scalar_one_or_none()

        if proposal is None or proposal.operation != "register_invoice":
            return not_found(
                "proposta_nao_encontrada", "Esta proposta de registro não existe.",
                hint="Prepare outra com prepare_batch_registration.",
            )
        if proposal.status == "applied" and proposal.receipt is not None:
            return {**proposal.receipt, "already_confirmed": True}  # type: ignore[return-value]
        if proposal.status != "prepared" or proposal.expires_at <= datetime.now(UTC):
            return refused(
                "proposta_expirada", "Esta proposta de registro não está mais disponível.",
                hint="Prepare outra para usar o estado atual da fatura.",
            )

    resolved_batch_id = proposal.batch_id if proposal is not None else batch_id
    assert resolved_batch_id is not None

    batch = session.execute(
        select(Batch).where(Batch.id == resolved_batch_id, Batch.tenant_id == tenant_id)
    ).scalar_one_or_none()

    if batch is None:
        return not_found(
            "lote_nao_encontrado", f"Nenhuma fatura com o id {resolved_batch_id}.",
            hint="Confira os batch_id do estado do razão, ou chame list_invoices.",
        )

    # A política pode ter mudado enquanto o turno esperava aprovação: a
    # revisão da fatura é revalidada AQUI, não no momento da proposta.
    if proposal is not None and batch.updated_at != proposal.entity_revision:
        return refused(
            "proposta_desatualizada",
            "A fatura mudou depois que o registro foi preparado; nada foi gravado.",
            hint="Prepare uma nova proposta e confira os valores atuais.",
        )

    # Idempotência: um replay do passo durável não confirma duas vezes.
    if batch.status == "confirmed":
        return CommitReceipt(
            action_id=None, mutation_id=f"batch:{batch.id}:confirmed", batch_id=batch.id,
            status="confirmed", confirmed_transactions=0, checksum_result=batch.checksum_result,
            revision_before=batch.updated_at.isoformat(), can_undo=False, already_confirmed=True,
        )
    if batch.status == "rejected":
        return refused(
            "lote_ja_decidido", "Esta fatura foi descartada e não pode ser registrada.",
            hint="Para registrar este documento, proponha um lote novo a partir da extração.",
        )

    if proposal is not None:
        claimed = session.execute(
            update(FinancialActionProposal)
            .where(
                FinancialActionProposal.id == proposal.id,
                FinancialActionProposal.status == "prepared",
            )
            .values(
                status="applied", applied_by=f"human:{user_id}", applied_at=datetime.now(UTC)
            )
            .returning(FinancialActionProposal.id)
        ).scalar_one_or_none()
        if claimed is None:
            settled = session.execute(
                select(FinancialActionProposal.receipt)
                .where(FinancialActionProposal.id == proposal.id)
            ).scalar_one_or_none()
            if settled is not None:
                return {**settled, "already_confirmed": True}  # type: ignore[return-value]
            return refused(
                "proposta_ja_decidida",
                "Esta proposta já está sendo aplicada ou foi encerrada.",
            )

    updated = session.execute(
        update(Transaction)
        .where(
            Transaction.batch_id == batch.id,
            Transaction.tenant_id == tenant_id,
            Transaction.status == "proposed",
        )
        .values(status="confirmed")
        .returning(Transaction.id)
    ).scalars().all()

    revision_before = batch.updated_at.isoformat()
    batch.status = "confirmed"
    batch.approved_by = f"human:{user_id}"
    batch.approved_at = datetime.now(UTC)
    session.flush()

    receipt = CommitReceipt(
        action_id=proposal.id if proposal is not None else None,
        mutation_id=f"batch:{batch.id}:confirmed", batch_id=batch.id, status="confirmed",
        confirmed_transactions=len(updated), checksum_result=batch.checksum_result,
        revision_before=revision_before, can_undo=False,
    )

    if proposal is not None:
        proposal.receipt = {
            "action_id": receipt.action_id, "mutation_id": receipt.mutation_id,
            "batch_id": receipt.batch_id, "status": receipt.status,
            "confirmed_transactions": receipt.confirmed_transactions,
            "checksum_result": receipt.checksum_result,
            "revision_before": receipt.revision_before, "can_undo": receipt.can_undo,
        }
        session.flush()

    return receipt
