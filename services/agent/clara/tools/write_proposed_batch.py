"""A escrita do lote proposto — porta de `agent/lib/write-proposed-batch.ts`.

Compartilhada por `propose_batch` e `propose_batch_from_extraction`: dois
chamadores com cópias divergentes é como o rascunho passaria a depender de
qual porta o criou.

Nesta ordem, numa transação só:
  1. documento existe;
  2. documento já registrado recusa (propor de novo duplicaria o gasto);
  3. rascunho EDITADO não é apagado em silêncio;
  4. rascunho intocado é substituído (idempotência por documento);
  5. lote + linhas entram; o emissor sobe ao documento se ele não tinha;
  6. suspeita de dupla contagem contra o que já está confirmado — AVISO, não
     bloqueio: duas compras idênticas no mesmo dia podem ser reais.
"""

from __future__ import annotations

import dataclasses
import uuid
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Batch, Document, Transaction
from clara.ledger.categories import category_slug
from clara.ledger.checksum import ChecksumReport, verify_checksum
from clara.ledger.invoice_label import FinancialDocumentKind as DocumentKind
from clara.ledger.invoice_label import format_document_label
from clara.ledger.merchant import merchant_key
from clara.ledger.statement import StatementBalanceReport, verify_statement_balance
from clara.ledger.types import Confidence, EntryKind
from clara.tools.category_scope import load_valid_categories
from clara.tools.errors import ToolError, refused, tool_error
from clara.tools.issuer_canonical import canonical_issuer


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"


@dataclass
class ProposedTransactionInput:
    date: str
    original_description: str
    amount: int
    extraction_confidence: Confidence
    merchant: str | None = None
    kind: EntryKind = "purchase"
    installment_current: int | None = None
    installment_total: int | None = None
    category: str | None = None
    page: int | None = None


@dataclass
class ProposedBatchWriteInput:
    document_id: str
    transactions: list[ProposedTransactionInput]
    document_kind: DocumentKind | None = None
    issuer: str | None = None
    period_start: str | None = None
    period_end: str | None = None
    due_date: str | None = None
    declared_total: int | None = None
    declared_subtotals: dict[str, int | None] | None = None
    opening_balance: int | None = None
    closing_balance: int | None = None
    overwrite_edited_draft: bool = False


@dataclass
class DuplicateSuspect:
    date: str
    amount_cents: int
    merchant: str | None
    existing_transaction_id: str
    existing_batch_id: str


@dataclass
class DroppedCategories:
    categories: list[str]
    note: str
    hint: str


@dataclass
class ProposedBatchWriteResult:
    batch_id: str
    document_kind: DocumentKind
    issuer: str | None
    invoice_label: str
    period_end: str | None
    due_date: str | None
    transaction_count: int
    checksum: ChecksumReport
    statement_balance: StatementBalanceReport | None = None
    duplicate_suspects: list[DuplicateSuspect] = field(default_factory=list)
    dropped_categories: DroppedCategories | None = None


def write_proposed_batch(
    session: Session, tenant_id: str, input: ProposedBatchWriteInput
) -> ProposedBatchWriteResult | ToolError:
    document = session.execute(
        select(Document).where(Document.id == input.document_id, Document.tenant_id == tenant_id)
    ).scalar_one_or_none()

    if document is None:
        return tool_error(
            "documento_nao_encontrado",
            f"Nenhum documento com o id {input.document_id}.",
            hint="Os documentId chegam no contexto do upload e aparecem em list_documents.",
        )

    valid_categories = load_valid_categories(session, tenant_id)

    # Categoria que não existe não entra no razão: vira None. "Entre uma
    # categoria errada e nenhuma, deixe nenhuma" — a linha aparece como "Sem
    # categoria", entra na fila de revisão, e o guarda-livros propõe a criação.
    invented = sorted(
        {
            t.category
            for t in input.transactions
            if t.category and category_slug(t.category) not in valid_categories
        }
    )

    document_kind = input.document_kind or document.kind

    # Já registrado: recusa ANTES de tocar no rascunho anterior.
    confirmed = session.execute(
        select(Batch.id).where(
            Batch.tenant_id == tenant_id,
            Batch.document_id == document.id,
            Batch.status == "confirmed",
        )
    ).scalar_one_or_none()
    if confirmed is not None:
        return refused(
            "documento_ja_registrado",
            "Este documento já está registrado no razão.",
            hint=(
                "Não proponha de novo. Para corrigir algo nela, "
                "chame read_batch e depois create_adjustment."
            ),
        )

    # Rascunho editado não é apagado em silêncio.
    if not input.overwrite_edited_draft:
        edited = session.execute(
            select(Batch.id).where(
                Batch.tenant_id == tenant_id,
                Batch.document_id == document.id,
                Batch.status == "proposed",
                Batch.updated_at > Batch.created_at,
            )
        ).scalar_one_or_none()
        if edited is not None:
            return tool_error(
                "rascunho_editado",
                (
                    "Este documento já tem um rascunho com correções feitas — "
                    "propor de novo as descartaria."
                ),
                hint=(
                    "Confirme com a pessoa se ela quer descartar as correções e recomeçar; "
                    "se sim, repita a chamada com overwrite_edited_draft=True. Para continuar "
                    "de onde parou, use read_batch e edit_proposed_batch."
                ),
            )

    # Idempotência por documento: reprocessar a mesma fatura não cria um
    # segundo rascunho. Só rascunho sai; o trigger do banco protege o confirmado.
    stale_batches = session.execute(
        select(Batch.id).where(
            Batch.tenant_id == tenant_id,
            Batch.document_id == document.id,
            Batch.status == "proposed",
        )
    ).scalars().all()
    for stale_id in stale_batches:
        session.query(Transaction).filter(Transaction.batch_id == stale_id).delete()
        session.query(Batch).filter(Batch.id == stale_id).delete()
    session.flush()

    prepared: list[dict[str, object]] = []
    for t in input.transactions:
        category = None
        if t.category and category_slug(t.category) in valid_categories:
            category = category_slug(t.category)
        prepared.append(
            {
                "id": _new_id("txn"),
                "date": t.date,
                "original_description": t.original_description,
                "merchant": t.merchant,
                "merchant_key": merchant_key(
                    original_description=t.original_description, merchant=t.merchant
                ),
                "amount": t.amount,
                "kind": t.kind,
                "installment_current": t.installment_current,
                "installment_total": t.installment_total,
                "category": category,
                "extraction_confidence": t.extraction_confidence,
                "page": t.page,
            }
        )

    checksum = verify_checksum(
        transactions=[
            {
                "id": p["id"],
                "amount": p["amount"],
                "kind": p["kind"],
                "extraction_confidence": p["extraction_confidence"],
                "page": p["page"],
            }
            for p in prepared
        ],  # type: ignore[misc]
        declared_total=input.declared_total,
        declared_subtotals=input.declared_subtotals,
    )

    statement_balance: StatementBalanceReport | None = None
    if document_kind == "bank_statement":
        statement_balance = verify_statement_balance(
            [{"amount": p["amount"]} for p in prepared],  # type: ignore[list-item]
            input.opening_balance, input.closing_balance,
        )

    if statement_balance is None:
        persisted_result: Literal["match", "mismatch", "no_declared_total"] = checksum.result
    else:
        persisted_result = (
            "match" if statement_balance.result == "match"
            else "mismatch" if statement_balance.result == "mismatch"
            else "no_declared_total"
        )

    batch_id = _new_id("bat")
    issuer = input.issuer or document.issuer

    persisted_report = (
        {**dataclasses.asdict(statement_balance)}
        if statement_balance is not None
        else {**dataclasses.asdict(checksum)}
    )

    session.add(
        Batch(
            id=batch_id, tenant_id=tenant_id, document_id=document.id, status="proposed",
            period_start=input.period_start, period_end=input.period_end,
            due_date=input.due_date,
            declared_total=input.declared_total, declared_subtotals=input.declared_subtotals,
            opening_balance=input.opening_balance, closing_balance=input.closing_balance,
            extracted_total=checksum.extracted_total, checksum_result=persisted_result,
            checksum_report=persisted_report,
        )
    )

    if input.document_kind is not None and document.kind != input.document_kind:
        document.kind = input.document_kind

    # O emissor mora no documento, não no lote. A grafia converge para a
    # existente quando a mesma operadora já apareceu com outra caixa/acento.
    if issuer is not None and document.issuer is None:
        document.issuer = canonical_issuer(session, tenant_id, issuer)
        issuer = document.issuer

    for p in prepared:
        session.add(
            Transaction(
                id=p["id"], tenant_id=tenant_id, batch_id=batch_id, status="proposed",
                date=p["date"], original_description=p["original_description"],
                merchant=p["merchant"], merchant_key=p["merchant_key"], amount=p["amount"],
                kind=p["kind"], installment_current=p["installment_current"],
                installment_total=p["installment_total"], category=p["category"],
                extraction_confidence=p["extraction_confidence"],
                source_document_id=document.id, page=p["page"],
            )
        )
    session.flush()

    # Suspeita de dupla contagem: compara com o que já está CONFIRMADO vindo
    # de outros documentos — mesma data, valor e identidade de comerciante.
    # Aviso, não bloqueio: quem decide é a pessoa, com os ids na mão.
    dates = {p["date"] for p in prepared}
    suspects: list[DuplicateSuspect] = []
    if dates:
        candidates = session.execute(
            select(Transaction).where(
                Transaction.tenant_id == tenant_id,
                Transaction.status == "confirmed",
                Transaction.date.in_(dates),
                Transaction.source_document_id != document.id,
            )
        ).scalars().all()
        by_fingerprint = {
            (c.date, c.amount, c.merchant_key): c for c in candidates
        }
        for p in prepared:
            match = by_fingerprint.get((p["date"], p["amount"], p["merchant_key"]))
            if match is not None:
                suspects.append(
                    DuplicateSuspect(
                        date=p["date"], amount_cents=p["amount"], merchant=p["merchant"],  # type: ignore[arg-type]
                        existing_transaction_id=match.id, existing_batch_id=match.batch_id,
                    )
                )

    dropped_categories = None
    if invented:
        names = ", ".join(invented)
        dropped_categories = DroppedCategories(
            categories=invented,
            note=(
                f"{len(invented)} categoria(s) que não existem para esta pessoa foram "
                f"deixadas em branco: {names}. Os lançamentos entraram sem categoria."
            ),
            hint=(
                'Diga isso à pessoa e ofereça criar a categoria com save_concept '
                '(type "Category", conceptId "categories/<slug>", title em português) — '
                "depois de aprovada, recategorize. Nunca force numa categoria existente "
                "só para não ficar em branco."
            ),
        )

    return ProposedBatchWriteResult(
        batch_id=batch_id, document_kind=document_kind, issuer=issuer,
        invoice_label=format_document_label(
            issuer=issuer, due_date=input.due_date, period_end=input.period_end,
            document_kind=document_kind,
        ),
        period_end=input.period_end, due_date=input.due_date,
        transaction_count=len(prepared), checksum=checksum,
        statement_balance=statement_balance, duplicate_suspects=suspects,
        dropped_categories=dropped_categories,
    )
