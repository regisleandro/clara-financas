"""O razão, em SQLAlchemy 2.0.

Porta fiel de `packages/db/src/schema/*.ts` — mesmos nomes de tabela e coluna,
para que um banco existente (migrado pelo Drizzle) continue servindo depois de
trocar a camada de acesso. `agent_tasks`, `conversation_artifacts`,
`conversation_goals` e `decision_proposals` não entram: foram removidas em
"feat(db): remover as quatro tabelas da família v3" e não fazem parte do
schema atual.

Dinheiro é `BigInteger` (centavos), não `Numeric`/`Decimal`: é o desenho já
usado pelo schema original (`bigint` em `declared_total`, `amount` etc.) e é
mais simples que decimal-sobre-numeric para o mesmo resultado — inteiro é
exato por construção, sem ponto flutuante em lugar nenhum do caminho.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import (
    BigInteger,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


class Base(DeclarativeBase):
    pass


TZDateTime = TIMESTAMP(timezone=True)


# ---------------------------------------------------------------------------
# Better Auth — somente leitura aqui. O serviço Python nunca escreve nestas
# tabelas; login continua sendo responsabilidade do control plane TypeScript.
# ---------------------------------------------------------------------------


class User(Base):
    __tablename__ = "user"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    email: Mapped[str] = mapped_column(Text, unique=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, server_default=text('false'))
    image: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# Tenant registry — vive no banco do control plane, nunca no de um tenant.
# ---------------------------------------------------------------------------

TenantStatus = Literal["provisioning", "ready", "failed"]


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: new_id("tenant"))
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    slug: Mapped[str] = mapped_column(Text, unique=True)
    status: Mapped[str] = mapped_column(Text, server_default=text("'provisioning'"))
    agent_host: Mapped[str | None] = mapped_column(Text)
    db_credential_ref: Mapped[str | None] = mapped_column(Text)
    provisioned_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    constitution_version: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())


ProvisioningStatus = Literal["queued", "running", "succeeded", "failed"]


class ProvisioningJob(Base):
    __tablename__ = "provisioning_jobs"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: new_id("job"))
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(Text, server_default=text("'queued'"))
    attempts: Mapped[int] = mapped_column(Integer, server_default=text('0'))
    last_error: Mapped[str | None] = mapped_column(Text)
    completed_steps: Mapped[list[str]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    started_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# O razão
# ---------------------------------------------------------------------------

DocumentKind = Literal["unknown", "credit_card_invoice", "bank_statement", "invoice_nfe"]


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        Index("documents_tenant_idx", "tenant_id"),
        UniqueConstraint("tenant_id", "content_hash", name="documents_tenant_hash_idx"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: new_id("doc"))
    tenant_id: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    blob_key: Mapped[str] = mapped_column(Text)
    filename: Mapped[str] = mapped_column(Text)
    issuer: Mapped[str | None] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(Text)
    uploaded_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())


BatchStatus = Literal["proposed", "confirmed", "rejected"]
ChecksumResult = Literal["match", "mismatch", "no_declared_total"]


class Batch(Base):
    __tablename__ = "batches"
    __table_args__ = (
        Index("batches_tenant_status_idx", "tenant_id", "status"),
        Index("batches_document_idx", "document_id"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: new_id("batch"))
    tenant_id: Mapped[str] = mapped_column(Text)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(Text, server_default=text("'proposed'"))

    period_start: Mapped[str | None] = mapped_column(Text)
    period_end: Mapped[str | None] = mapped_column(Text)
    due_date: Mapped[str | None] = mapped_column(Text)

    declared_total: Mapped[int | None] = mapped_column(BigInteger)
    declared_subtotals: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    opening_balance: Mapped[int | None] = mapped_column(BigInteger)
    closing_balance: Mapped[int | None] = mapped_column(BigInteger)
    extracted_total: Mapped[int | None] = mapped_column(BigInteger)
    checksum_result: Mapped[str | None] = mapped_column(Text)
    checksum_report: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    approved_by: Mapped[str | None] = mapped_column(Text)
    approved_at: Mapped[datetime | None] = mapped_column(TZDateTime)

    created_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())

    transactions: Mapped[list[Transaction]] = relationship(back_populates="batch")


TransactionStatus = Literal["proposed", "confirmed", "adjustment"]
Confidence = Literal["alta", "media", "baixa"]
EntryKind = Literal[
    "purchase",
    "payment",
    "refund",
    "fee",
    "adjustment",
    "income",
    "transfer",
    "card_payment",
    "cash_withdrawal",
]


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        Index("transactions_tenant_status_idx", "tenant_id", "status"),
        Index("transactions_batch_idx", "batch_id"),
        Index("transactions_tenant_date_idx", "tenant_id", "date"),
        Index("transactions_adjusts_idx", "adjusts_transaction_id"),
        UniqueConstraint("tenant_id", "action_id", name="transactions_tenant_action_idx"),
        Index("transactions_tenant_merchant_idx", "tenant_id", "merchant_key"),
        Index("transactions_tenant_reviewed_idx", "tenant_id", "reviewed_at"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: new_id("txn"))
    tenant_id: Mapped[str] = mapped_column(Text)
    batch_id: Mapped[str] = mapped_column(ForeignKey("batches.id", ondelete="CASCADE"))

    status: Mapped[str] = mapped_column(Text, server_default=text("'proposed'"))

    date: Mapped[str] = mapped_column(Text)
    original_description: Mapped[str] = mapped_column(Text)
    merchant: Mapped[str | None] = mapped_column(Text)
    merchant_key: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[int] = mapped_column(BigInteger)
    kind: Mapped[str] = mapped_column(Text, server_default=text("'purchase'"))
    installment_current: Mapped[int | None] = mapped_column(Integer)
    installment_total: Mapped[int | None] = mapped_column(Integer)
    category: Mapped[str | None] = mapped_column(Text)
    extraction_confidence: Mapped[str] = mapped_column(Text)

    source_document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    page: Mapped[int | None] = mapped_column(Integer)

    adjusts_transaction_id: Mapped[str | None] = mapped_column(Text)
    action_id: Mapped[str | None] = mapped_column(Text)

    reviewed_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    reviewed_by: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())

    batch: Mapped[Batch] = relationship(back_populates="transactions")


class TransactionReclassification(Base):
    __tablename__ = "transaction_reclassifications"
    __table_args__ = (
        Index("reclassifications_tenant_idx", "tenant_id"),
        Index("reclassifications_transaction_idx", "transaction_id"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: new_id("reclass"))
    tenant_id: Mapped[str] = mapped_column(Text)
    transaction_id: Mapped[str] = mapped_column(ForeignKey("transactions.id", ondelete="CASCADE"))
    field: Mapped[str] = mapped_column(Text)  # "category" | "merchant"
    previous_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    author: Mapped[str] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text)
    by_concept_id: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())


FinancialActionOperation = Literal["resolve_invoice_difference", "register_invoice"]
FinancialActionStatus = Literal["prepared", "applied", "rejected"]


class FinancialActionProposal(Base):
    __tablename__ = "financial_action_proposals"
    __table_args__ = (
        Index("financial_actions_tenant_status_idx", "tenant_id", "status"),
        Index("financial_actions_batch_idx", "batch_id"),
        UniqueConstraint("tenant_id", "id", name="financial_actions_tenant_id_idx"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: new_id("action"))
    tenant_id: Mapped[str] = mapped_column(Text)
    batch_id: Mapped[str] = mapped_column(ForeignKey("batches.id", ondelete="CASCADE"))
    operation: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default=text("'prepared'"))
    entity_revision: Mapped[datetime] = mapped_column(TZDateTime)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    receipt: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    prepared_by: Mapped[str] = mapped_column(Text)
    applied_by: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(TZDateTime)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())
    applied_at: Mapped[datetime | None] = mapped_column(TZDateTime)


class ExtractionStaging(Base):
    __tablename__ = "extraction_stagings"
    __table_args__ = (
        Index("extraction_stagings_tenant_document_idx", "tenant_id", "document_id"),
        Index("extraction_stagings_tenant_created_idx", "tenant_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: new_id("stg"))
    tenant_id: Mapped[str] = mapped_column(Text)
    document_id: Mapped[str] = mapped_column(Text)
    parent_session_id: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# Compromissos e avisos
# ---------------------------------------------------------------------------

CommitmentKind = Literal["invoice_due", "subscription_charge", "custom"]


class Commitment(Base):
    __tablename__ = "commitments"
    __table_args__ = (Index("commitments_tenant_due_idx", "tenant_id", "due_date"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: new_id("commit"))
    tenant_id: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    counterparty: Mapped[str | None] = mapped_column(Text)
    due_date: Mapped[str] = mapped_column(Text)
    recurrence_day_of_month: Mapped[int | None] = mapped_column(Integer)
    expected_amount: Mapped[int | None] = mapped_column(Integer)
    remind_days_before: Mapped[int] = mapped_column(Integer, server_default=text('3'))
    last_notified_for: Mapped[str | None] = mapped_column(Text)
    concept_id: Mapped[str | None] = mapped_column(Text)
    active: Mapped[str] = mapped_column(Text, server_default=text("'yes'"))
    created_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("notifications_tenant_created_idx", "tenant_id", "created_at"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: new_id("notif"))
    tenant_id: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)  # "due_date" | "monthly_digest"
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    commitment_id: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(Text)
    read_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# Conhecimento (OKF v0.2)
# ---------------------------------------------------------------------------

Bundle = Literal["constitution", "learnings"]


class Concept(Base):
    __tablename__ = "concepts"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "bundle", "concept_id", name="concepts_tenant_bundle_concept_idx"
        ),
        Index("concepts_tenant_type_idx", "tenant_id", "type"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: new_id("concept"))
    tenant_id: Mapped[str] = mapped_column(Text)
    bundle: Mapped[str] = mapped_column(Text)
    concept_id: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(Text)
    frontmatter: Mapped[dict[str, Any]] = mapped_column(JSONB)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())


class ConceptRevision(Base):
    __tablename__ = "concept_revisions"
    __table_args__ = (
        Index("concept_revisions_tenant_concept_idx", "tenant_id", "concept_row_id"),
        Index("concept_revisions_created_at_idx", "created_at"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: new_id("rev"))
    tenant_id: Mapped[str] = mapped_column(Text)
    concept_row_id: Mapped[str] = mapped_column(ForeignKey("concepts.id", ondelete="CASCADE"))
    author: Mapped[str] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text)
    frontmatter: Mapped[dict[str, Any]] = mapped_column(JSONB)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# Observabilidade e sessão do agente
# ---------------------------------------------------------------------------

AgentEventStatus = Literal["ok", "recuperavel", "falha"]


class AgentToolEvent(Base):
    __tablename__ = "agent_tool_events"
    __table_args__ = (
        Index("agent_tool_events_tenant_created_idx", "tenant_id", "created_at"),
        Index("agent_tool_events_tenant_status_idx", "tenant_id", "status"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: new_id("evt"))
    tenant_id: Mapped[str] = mapped_column(Text)
    session_id: Mapped[str | None] = mapped_column(Text)
    turn_id: Mapped[str | None] = mapped_column(Text)
    call_id: Mapped[str | None] = mapped_column(Text)
    tool_name: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    input_summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())


class AgentSession(Base):
    """Posse de sessão — a ACL que o Agno, como o Eve antes dele, não oferece."""

    __tablename__ = "agent_sessions"
    __table_args__ = (
        Index("agent_sessions_tenant_idx", "tenant_id"),
        Index("agent_sessions_active_batch_idx", "active_batch_id"),
    )

    session_id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(Text)
    user_id: Mapped[str] = mapped_column(Text)
    active_batch_id: Mapped[str | None] = mapped_column(
        ForeignKey("batches.id", ondelete="SET NULL")
    )
    focus_updated_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())


AgentArtifactKind = Literal["analysis", "categorization"]


class AgentArtifact(Base):
    __tablename__ = "agent_artifacts"
    __table_args__ = (
        Index("agent_artifacts_tenant_session_idx", "tenant_id", "parent_session_id"),
        Index("agent_artifacts_tenant_expires_idx", "tenant_id", "expires_at"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: new_id("artifact"))
    tenant_id: Mapped[str] = mapped_column(Text)
    parent_session_id: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    payload: Mapped[Any] = mapped_column(JSONB)
    expires_at: Mapped[datetime] = mapped_column(TZDateTime)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, server_default=func.now())
