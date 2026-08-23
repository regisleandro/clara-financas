"""Compromissos, avisos e proatividade (US4) — porta dos casos reais de
`save_commitment.ts`, `list_commitments.ts`, `deactivate_commitment.ts`,
`list_notifications.ts`, `set_proactivity.ts`, `apply_learned_rules.ts`,
`reminders.ts`."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from clara.agents.reminders import sweep_due_dates
from clara.db.models import Concept, Transaction
from clara.db.tenant_scope import for_tenant
from clara.knowledge.proactivity import proactivity_enabled
from clara.tools.apply_learned_rules import (
    ApplyLearnedRulesResult,
    EmptyRulesResult,
    PreviewResult,
    apply_learned_rules,
    preview_learned_rules,
)
from clara.tools.deactivate_commitment import DeactivateCommitmentResult, deactivate_commitment
from clara.tools.list_commitments import ListCommitmentsResult, list_commitments
from clara.tools.list_notifications import list_notifications
from clara.tools.save_commitment import SaveCommitmentResult, save_commitment
from clara.tools.set_proactivity import set_proactivity


def test_save_commitment_creates_then_upsert_reactivates(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        first = save_commitment(
            session,
            tenant_id,
            kind="invoice_due",
            title="Fatura Nubank",
            due_date="2026-09-10",
            counterparty="Nubank",
        )

    assert isinstance(first, SaveCommitmentResult)

    with for_tenant(tenant_id) as session:
        deactivate_commitment(session, tenant_id, first.commitment_id)

    with for_tenant(tenant_id) as session:
        second = save_commitment(
            session,
            tenant_id,
            kind="invoice_due",
            title="Fatura Nubank",
            due_date="2026-10-10",
            counterparty="Nubank",
        )

    # Mesmo (kind, counterparty): reusa a linha e reativa.
    assert second.commitment_id == first.commitment_id

    with for_tenant(tenant_id) as session:
        listed = list_commitments(session, tenant_id)

    assert isinstance(listed, ListCommitmentsResult)
    assert [c.id for c in listed.commitments] == [first.commitment_id]
    assert listed.commitments[0].due_date == "2026-10-10"


def test_save_commitment_custom_kind_never_upserts(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        first = save_commitment(
            session, tenant_id, kind="custom", title="Lembrete A", due_date="2026-09-10"
        )
        second = save_commitment(
            session, tenant_id, kind="custom", title="Lembrete B", due_date="2026-09-11"
        )

    assert first.commitment_id != second.commitment_id


def test_deactivate_commitment_is_idempotent(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        created = save_commitment(
            session, tenant_id, kind="custom", title="Lembrete", due_date="2026-09-10"
        )

    with for_tenant(tenant_id) as session:
        result = deactivate_commitment(session, tenant_id, created.commitment_id)
    assert isinstance(result, DeactivateCommitmentResult)
    assert result.already_inactive is False

    with for_tenant(tenant_id) as session:
        again = deactivate_commitment(session, tenant_id, created.commitment_id)
    assert isinstance(again, DeactivateCommitmentResult)
    assert again.already_inactive is True


def test_deactivate_commitment_refuses_unknown_id(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        result = deactivate_commitment(session, tenant_id, "commit_nao_existe")

    assert isinstance(result, dict)
    assert result["error"]["code"] == "compromisso_nao_encontrado"


def test_list_commitments_excludes_deactivated(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        kept = save_commitment(
            session, tenant_id, kind="custom", title="Fica", due_date="2026-09-10"
        )
        removed = save_commitment(
            session, tenant_id, kind="custom", title="Sai", due_date="2026-09-11"
        )
        deactivate_commitment(session, tenant_id, removed.commitment_id)

    with for_tenant(tenant_id) as session:
        listed = list_commitments(session, tenant_id)

    assert [c.id for c in listed.commitments] == [kept.commitment_id]


def test_proactivity_defaults_to_enabled_without_a_concept(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        assert proactivity_enabled(session, tenant_id) is True


def test_set_proactivity_off_then_sweep_creates_no_notification(
    tenant_id: str, raw_session: Session
) -> None:
    with for_tenant(tenant_id) as session:
        save_commitment(
            session, tenant_id, kind="custom", title="Vence logo", due_date="2026-06-02",
            remind_days_before=5,
        )
        set_proactivity(session, tenant_id, "user_1", enabled=False)
    # `sweep_due_dates` lê `tenants` numa conexão própria — precisa que a
    # linha do tenant, inserida pela fixture, já esteja COMMITADA.
    raw_session.commit()

    with for_tenant(tenant_id) as session:
        assert proactivity_enabled(session, tenant_id) is False

    result = sweep_due_dates(today="2026-06-01")
    assert not any(c.tenant_id == tenant_id for c in result.created)

    with for_tenant(tenant_id) as session:
        notifications = list_notifications(session, tenant_id)
    assert notifications.count == 0


def test_sweep_due_dates_creates_notification_inside_the_warning_window(
    tenant_id: str, raw_session: Session
) -> None:
    with for_tenant(tenant_id) as session:
        save_commitment(
            session, tenant_id, kind="custom", title="Vence logo", due_date="2026-06-02",
            remind_days_before=5,
        )
    raw_session.commit()

    result = sweep_due_dates(today="2026-06-01")
    assert any(c.tenant_id == tenant_id for c in result.created)

    with for_tenant(tenant_id) as session:
        notifications = list_notifications(session, tenant_id)
    assert notifications.count == 1
    assert notifications.notifications[0].seen_at is None


def test_sweep_due_dates_does_not_repeat_the_same_warning(
    tenant_id: str, raw_session: Session
) -> None:
    with for_tenant(tenant_id) as session:
        save_commitment(
            session, tenant_id, kind="custom", title="Vence logo", due_date="2026-06-02",
            remind_days_before=5,
        )
    raw_session.commit()

    sweep_due_dates(today="2026-06-01")
    sweep_due_dates(today="2026-06-01")

    with for_tenant(tenant_id) as session:
        notifications = list_notifications(session, tenant_id)
    assert notifications.count == 1


def test_sweep_due_dates_advances_a_recurring_commitment_past_due(
    tenant_id: str, raw_session: Session
) -> None:
    with for_tenant(tenant_id) as session:
        created = save_commitment(
            session, tenant_id, kind="custom", title="Assinatura", due_date="2026-05-31",
            recurrence_day_of_month=31, remind_days_before=5,
        )
    raw_session.commit()

    sweep_due_dates(today="2026-06-01")  # gera o aviso e marca last_notified_for
    sweep_due_dates(today="2026-06-02")  # já avisado E vencido: avança o ciclo

    with for_tenant(tenant_id) as session:
        listed = list_commitments(session, tenant_id)

    row = next(c for c in listed.commitments if c.id == created.commitment_id)
    assert row.due_date == "2026-06-30"  # 31 de junho não existe: ancora no último dia


def _add_rule(session, tenant: str, merchant: str, category: str) -> None:  # noqa: ANN001
    session.add(
        Concept(
            tenant_id=tenant,
            bundle="learnings",
            concept_id=f"rules/{uuid.uuid4().hex[:8]}",
            type="CategorizationRule",
            frontmatter={"title": "regra", "merchant": merchant},
            body=f"Sempre [Categoria](/categories/{category}.md).",
        )
    )
    session.flush()


def _add_uncategorized_transaction(session, tenant: str, merchant: str) -> str:  # noqa: ANN001
    from clara.db.models import Batch, Document

    doc_id = f"doc_{uuid.uuid4().hex}"
    batch_id = f"batch_{uuid.uuid4().hex}"
    txn_id = f"txn_{uuid.uuid4().hex}"
    session.add(
        Document(
            id=doc_id,
            tenant_id=tenant,
            kind="credit_card_invoice",
            blob_key="k",
            filename="f.pdf",
            content_hash=uuid.uuid4().hex,
        )
    )
    session.flush()
    session.add(Batch(id=batch_id, tenant_id=tenant, document_id=doc_id, status="confirmed"))
    session.flush()
    session.add(
        Transaction(
            id=txn_id, tenant_id=tenant, batch_id=batch_id, status="confirmed", date="2026-06-01",
            original_description="compra crua", merchant=merchant, amount=1000, kind="purchase",
            category=None, extraction_confidence="alta", source_document_id=doc_id,
        )
    )
    session.flush()
    return txn_id


def test_apply_learned_rules_empty_when_no_rules(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        result = preview_learned_rules(session, tenant_id)

    assert isinstance(result, EmptyRulesResult)


def test_apply_learned_rules_preview_then_apply_round_trip(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _add_rule(session, tenant_id, "mercado sao jose", "groceries")
        txn_id = _add_uncategorized_transaction(session, tenant_id, "Mercado Sao Jose")

    with for_tenant(tenant_id) as session:
        preview = preview_learned_rules(session, tenant_id)

    assert isinstance(preview, PreviewResult)
    assert preview.transaction_ids == [txn_id]

    with for_tenant(tenant_id) as session:
        applied = apply_learned_rules(
            session, tenant_id, "user_1", expected_transaction_ids=preview.transaction_ids
        )

    assert isinstance(applied, ApplyLearnedRulesResult)
    assert applied.applied == 1

    with for_tenant(tenant_id) as session:
        txn = session.get(Transaction, txn_id)
        assert txn is not None
        assert txn.category == "groceries"


def test_apply_learned_rules_refuses_when_scope_changed(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        _add_rule(session, tenant_id, "mercado sao jose", "groceries")
        _add_uncategorized_transaction(session, tenant_id, "Mercado Sao Jose")

    with for_tenant(tenant_id) as session:
        result = apply_learned_rules(
            session, tenant_id, "user_1", expected_transaction_ids=["txn_id_errado"]
        )

    assert isinstance(result, dict)
    assert result["error"]["code"] == "alcance_alterado"
