"""O GATE de uma resolução de divergência — porta de
`agent/tools/apply_invoice_resolution.ts`.

Mesma disciplina de `commit_batch`: a revisão da fatura e a diferença atual
são revalidadas na EXECUÇÃO, não na proposta (FR-012), porque a política —
ou a própria fatura — pode ter mudado enquanto o turno esperava aprovação.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Batch, FinancialActionProposal, Transaction
from clara.ledger.financial_actions import invoice_resolution_plan
from clara.ledger.money import format_cents
from clara.tools.errors import ToolError, not_found, refused
from clara.tools.recompute_batch_checksum import recompute_batch_checksum


@dataclass(frozen=True)
class ResolutionReceipt:
    action_id: str
    mutation_id: str
    proposal_id: str
    batch_id: str
    operation: str
    revision_before: str
    adjustment_cents: int
    adjustment_formatted: str
    difference_before_cents: int
    difference_after_cents: int | None
    status: str
    can_undo: bool
    audited_by: str


def apply_invoice_resolution(
    session: Session, tenant_id: str, user_id: str, *, proposal_id: str
) -> ResolutionReceipt | ToolError:
    proposal = session.execute(
        select(FinancialActionProposal).where(
            FinancialActionProposal.id == proposal_id,
            FinancialActionProposal.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()

    if proposal is None or proposal.operation != "resolve_invoice_difference":
        return not_found(
            "proposta_nao_encontrada",
            "Esta proposta de ajuste não existe.",
            hint="Prepare uma nova proposta com prepare_invoice_resolution.",
        )
    if proposal.status == "applied" and proposal.receipt is not None:
        return {**proposal.receipt, "already_applied": True}  # type: ignore[return-value]
    if proposal.status != "prepared":
        return refused("proposta_ja_decidida", "Esta proposta já foi encerrada.")
    if proposal.expires_at <= datetime.now(UTC):
        return refused(
            "proposta_expirada",
            "A fatura pode ter mudado desde esta proposta.",
            hint="Prepare uma nova proposta para usar os valores atuais.",
        )

    batch = session.execute(
        select(Batch).where(Batch.id == proposal.batch_id, Batch.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if batch is None:
        return not_found("lote_nao_encontrado", "A fatura desta proposta não existe mais.")

    # A política pode ter mudado enquanto o turno esperava aprovação: a
    # revisão da fatura é revalidada AQUI, não no momento da proposta.
    if batch.updated_at != proposal.entity_revision or batch.status != "confirmed":
        return refused(
            "proposta_desatualizada",
            "A fatura mudou depois que esta proposta foi preparada; nada foi aplicado.",
            hint="Leia a fatura e prepare uma nova proposta.",
        )

    payload = proposal.payload
    report = batch.checksum_report or {}
    current_difference = report.get("difference")
    current_plan = invoice_resolution_plan(current_difference)
    if (
        report.get("result") != "mismatch"
        or current_difference != payload["difference_before_cents"]
        or current_plan is None
        or payload["adjustment_cents"] != current_plan.adjustment_cents
    ):
        return refused(
            "proposta_desatualizada",
            "A diferença atual não é mais a que foi aprovada; nada foi aplicado.",
            hint="Prepare uma nova proposta para recalcular o ajuste.",
        )

    target_transaction_id = payload.get("target_transaction_id")
    target: Transaction | None = None
    if target_transaction_id is not None:
        target = session.execute(
            select(Transaction).where(
                Transaction.id == target_transaction_id,
                Transaction.batch_id == batch.id,
                Transaction.tenant_id == tenant_id,
            )
        ).scalar_one_or_none()
        if target is None:
            return refused(
                "proposta_desatualizada",
                "O lançamento relacionado à proposta não está mais disponível.",
                hint="Prepare uma nova proposta sem alvo ou escolha outra linha.",
            )

    # Idempotência: um replay do passo durável não cria um segundo ajuste —
    # `(tenant_id, action_id)` é único.
    existing_adjustment_id = session.execute(
        select(Transaction.id).where(
            Transaction.tenant_id == tenant_id, Transaction.action_id == proposal.id
        )
    ).scalar_one_or_none()

    if existing_adjustment_id is None:
        adjustment_id = f"txn_{uuid.uuid4().hex[:20]}"
        session.add(
            Transaction(
                id=adjustment_id,
                tenant_id=tenant_id,
                batch_id=batch.id,
                source_document_id=batch.document_id,
                status="adjustment",
                adjusts_transaction_id=target.id if target is not None else None,
                action_id=proposal.id,
                date=(
                    payload.get("effective_date")
                    or (target.date if target is not None else None)
                    or batch.period_end
                    or batch.due_date
                    or datetime.now(UTC).date().isoformat()
                ),
                original_description=f"Ajuste de conferência: {payload['reason']}",
                merchant=target.merchant if target is not None else None,
                merchant_key=target.merchant_key if target is not None else None,
                amount=payload["adjustment_cents"],
                kind="adjustment",
                category=target.category if target is not None else None,
                extraction_confidence="alta",
                reviewed_at=datetime.now(UTC),
                reviewed_by=f"human:{user_id}",
            )
        )
        session.flush()
        effective_adjustment_id = adjustment_id
    else:
        effective_adjustment_id = existing_adjustment_id

    recomputed = recompute_batch_checksum(session, tenant_id, batch)
    if recomputed.checksum.result != "match" or recomputed.checksum.difference != 0:
        raise RuntimeError("O ajuste calculado não zerou a conferência; a operação foi revertida.")

    receipt = ResolutionReceipt(
        action_id=proposal.id,
        mutation_id=effective_adjustment_id,
        proposal_id=proposal.id,
        batch_id=batch.id,
        operation="resolve_invoice_difference",
        revision_before=proposal.entity_revision.isoformat(),
        adjustment_cents=payload["adjustment_cents"],
        adjustment_formatted=format_cents(payload["adjustment_cents"]),
        difference_before_cents=payload["difference_before_cents"],
        difference_after_cents=recomputed.checksum.difference,
        status="applied",
        can_undo=False,
        audited_by=f"human:{user_id}",
    )

    proposal.status = "applied"
    proposal.receipt = {
        "action_id": receipt.action_id,
        "mutation_id": receipt.mutation_id,
        "proposal_id": receipt.proposal_id,
        "batch_id": receipt.batch_id,
        "operation": receipt.operation,
        "revision_before": receipt.revision_before,
        "adjustment_cents": receipt.adjustment_cents,
        "adjustment_formatted": receipt.adjustment_formatted,
        "difference_before_cents": receipt.difference_before_cents,
        "difference_after_cents": receipt.difference_after_cents,
        "status": receipt.status,
        "can_undo": receipt.can_undo,
        "audited_by": receipt.audited_by,
    }
    proposal.applied_by = f"human:{user_id}"
    proposal.applied_at = datetime.now(UTC)
    session.flush()

    return receipt
