"""Calcula e congela a proposta de fechamento de uma divergência de fatura
JÁ CONFIRMADA — porta de `agent/tools/prepare_invoice_resolution.ts`.

O sinal nunca vem do modelo: `difference = extraído - declarado`, e o único
delta que zera a conferência é `-difference` — `invoice_resolution_plan()`
é o único lugar que decide isso.

Sem gate: só congela um cálculo e grava uma proposta pendente, do mesmo jeito
que `prepare_batch_registration` não é ela quem grava no razão.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Batch, Document, FinancialActionProposal, Transaction
from clara.ledger.financial_actions import invoice_resolution_plan
from clara.ledger.invoice_label import format_document_label
from clara.ledger.money import format_cents
from clara.tools.errors import ToolError, not_found, refused

EXPIRES_IN = timedelta(minutes=30)


@dataclass(frozen=True)
class TargetIgnored:
    requested_id: str
    reason: str


@dataclass(frozen=True)
class PreparedResolution:
    proposal_id: str
    action_id: str
    batch_id: str
    entity_revision: datetime
    expires_at: datetime
    issuer: str | None
    invoice_label: str
    target_transaction_id: str | None
    target_description: str | None
    target_ignored: TargetIgnored | None
    difference_before_cents: int
    difference_before_formatted: str
    adjustment_cents: int
    adjustment_formatted: str
    difference_after_expected_cents: int
    reason: str
    next: str


def prepare_invoice_resolution(
    session: Session,
    tenant_id: str,
    user_id: str,
    *,
    batch_id: str,
    target_transaction_id: str | None = None,
    reason: str,
) -> PreparedResolution | ToolError:
    row = session.execute(
        select(Batch, Document.issuer, Document.kind)
        .join(Document, Document.id == Batch.document_id)
        .where(Batch.id == batch_id, Batch.tenant_id == tenant_id)
    ).first()
    if row is None:
        return not_found(
            "lote_nao_encontrado",
            f"Nenhum documento com o id {batch_id}.",
            hint="Chame list_invoices para obter o batch_id atual.",
        )
    batch, issuer, document_kind = row

    if batch.status != "confirmed":
        return refused(
            "operacao_nao_permitida",
            "O documento ainda é rascunho; corrija as linhas antes de registrá-lo.",
            hint="Use edit_proposed_batch para uma fatura em rascunho.",
        )

    report = batch.checksum_report or {}
    if report.get("kind") == "statement_balance":
        return refused(
            "operacao_nao_permitida",
            "Extratos são reconciliados pelo saldo inicial e final, não por ajuste de fatura.",
            hint="Use read_batch para conferir o saldo e create_adjustment para uma correção "
            "explícita.",
        )

    difference = report.get("difference")
    plan = invoice_resolution_plan(difference)
    if report.get("result") != "mismatch" or plan is None:
        return refused(
            "fatura_sem_divergencia",
            "Esta fatura não tem uma diferença aberta que peça ajuste.",
            hint="Chame read_batch para ler a conferência atual.",
        )

    # Alvo inválido NÃO cancela o ajuste: o delta sai só da diferença da
    # conferência, e a proposta segue no nível da fatura — recusar travaria a
    # correção inteira num caso em que o próprio relatório diz que não há
    # culpado (`likely_cause: "rounding"`).
    target: Transaction | None = None
    target_ignored: TargetIgnored | None = None
    if target_transaction_id is not None:
        target = session.execute(
            select(Transaction).where(
                Transaction.id == target_transaction_id,
                Transaction.batch_id == batch.id,
                Transaction.tenant_id == tenant_id,
            )
        ).scalar_one_or_none()
        if target is None:
            target_ignored = TargetIgnored(
                requested_id=target_transaction_id,
                reason="O id indicado não é um lançamento desta fatura; o ajuste foi preparado "
                "no nível da fatura.",
            )

    proposal_id = f"act_{uuid.uuid4().hex[:24]}"
    expires_at = datetime.now(UTC) + EXPIRES_IN
    invoice_label = format_document_label(
        issuer=issuer, due_date=batch.due_date, period_end=batch.period_end,
        document_kind=document_kind,
    )

    payload: dict[str, object] = {
        "adjustment_cents": plan.adjustment_cents,
        "difference_before_cents": plan.difference_before_cents,
        "difference_after_expected_cents": plan.difference_after_expected_cents,
        "target_transaction_id": target.id if target is not None else None,
        "target_description": target.original_description if target is not None else None,
        "target_ignored": (
            {"requested_id": target_ignored.requested_id, "reason": target_ignored.reason}
            if target_ignored is not None
            else None
        ),
        "reason": reason,
        "issuer": issuer,
        "invoice_label": invoice_label,
        "effective_date": (
            (target.date if target is not None else None) or batch.period_end or batch.due_date
        ),
    }

    session.add(
        FinancialActionProposal(
            id=proposal_id, tenant_id=tenant_id, batch_id=batch.id,
            operation="resolve_invoice_difference", entity_revision=batch.updated_at,
            payload=payload, prepared_by=f"human:{user_id}", expires_at=expires_at,
        )
    )
    session.flush()

    return PreparedResolution(
        proposal_id=proposal_id,
        action_id=proposal_id,
        batch_id=batch.id,
        entity_revision=batch.updated_at,
        expires_at=expires_at,
        issuer=issuer,
        invoice_label=invoice_label,
        target_transaction_id=target.id if target is not None else None,
        target_description=target.original_description if target is not None else None,
        target_ignored=target_ignored,
        difference_before_cents=plan.difference_before_cents,
        difference_before_formatted=format_cents(plan.difference_before_cents),
        adjustment_cents=plan.adjustment_cents,
        adjustment_formatted=format_cents(plan.adjustment_cents),
        difference_after_expected_cents=plan.difference_after_expected_cents,
        reason=reason,
        next=(
            "Call apply_invoice_resolution with this proposal_id. Do not ask for a prose "
            "confirmation."
            if target_ignored is None
            else "The target was ignored and the proposal is invoice-level. Call "
            "apply_invoice_resolution with this proposal_id anyway — do not prepare again and "
            "do not ask for a prose confirmation."
        ),
    )
