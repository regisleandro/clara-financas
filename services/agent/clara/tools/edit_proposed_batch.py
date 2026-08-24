"""Corrige itens de um lote AINDA EM RASCUNHO e reconfere a soma — porta de
`agent/tools/edit_proposed_batch.ts`.

Sem gate, e o motivo importa: o gate protege o razão, e rascunho não é
razão. Se editar exigisse aprovação, cada correção viraria um ciclo de
negar-e-repropor — e o botão "Corrigir" do cartão, que a pessoa usa várias
vezes seguidas, ficaria insuportável. O trigger do banco recusa qualquer
edição em linha já confirmada, então esta tool não tem como tocar no razão
nem por engano.

Simplificação deliberada frente ao original: aqui um campo omitido e um
campo `None` são a mesma coisa ("não mexa"), então `category`/`merchant` não
têm caminho para serem limpos explicitamente por esta tool — igual à
convenção do resto do port (nenhuma outra tool distingue "omitido" de
"nulo"). Uma categoria errada dá pra TROCAR; para limpá-la sem trocar,
remova e recrie a linha com `add`/`remove_transaction_ids`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Batch, Transaction
from clara.ledger.categories import category_slug
from clara.ledger.checksum import ChecksumReport
from clara.ledger.merchant import merchant_key
from clara.ledger.types import Confidence, EntryKind
from clara.tools.category_scope import load_valid_categories
from clara.tools.errors import ToolError, not_found, refused, tool_error
from clara.tools.recompute_batch_checksum import recompute_batch_checksum


@dataclass(frozen=True)
class TransactionEdit:
    transaction_id: str
    date: str | None = None
    amount: int | None = None
    kind: EntryKind | None = None
    extraction_confidence: Confidence | None = None
    category: str | None = None
    merchant: str | None = None
    original_description: str | None = None


@dataclass(frozen=True)
class NewTransaction:
    date: str
    original_description: str
    amount: int
    merchant: str | None = None
    kind: EntryKind = "purchase"
    category: str | None = None
    page: int | None = None


@dataclass(frozen=True)
class AppliedCounts:
    edited: int
    removed: int
    added: int


@dataclass(frozen=True)
class EditProposedBatchResult:
    batch_id: str
    transaction_count: int
    checksum: ChecksumReport
    applied: AppliedCounts
    dropped_categories: list[str] = field(default_factory=list)


def edit_proposed_batch(
    session: Session,
    tenant_id: str,
    *,
    batch_id: str,
    edits: list[TransactionEdit] | None = None,
    remove_transaction_ids: list[str] | None = None,
    add: list[NewTransaction] | None = None,
) -> EditProposedBatchResult | ToolError:
    edits = edits or []
    remove_transaction_ids = remove_transaction_ids or []
    add = add or []

    # `edits` era obrigatório com `.min(1)` no original, o que proibia a
    # operação mais comum de uma divergência tipo "item": só REMOVER a linha
    # duplicada. Aqui qualquer uma das três listas basta.
    if not edits and not remove_transaction_ids and not add:
        return tool_error(
            "recorte_incompleto", "Informe ao menos uma correção, remoção ou inclusão."
        )

    batch = session.execute(
        select(Batch).where(Batch.id == batch_id, Batch.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if batch is None:
        return not_found(
            "lote_nao_encontrado",
            f"Nenhuma fatura com o id {batch_id}.",
            hint="Confira os batch_id do estado do razão, ou chame list_invoices.",
        )
    if batch.status != "proposed":
        return refused(
            "lote_ja_decidido",
            "Esta fatura já foi registrada no razão, e lançamento confirmado não se edita.",
            hint="Para corrigir algo aqui, chame create_adjustment com o transaction_id e o "
            "valor da correção.",
        )

    valid_categories = load_valid_categories(session, tenant_id)
    dropped: set[str] = set()

    def resolved_category(raw: str) -> str | None:
        slug = category_slug(raw)
        if slug not in valid_categories:
            dropped.add(slug)
            return None
        return slug

    edited = 0
    for edit in edits:
        transaction = session.execute(
            select(Transaction).where(
                Transaction.id == edit.transaction_id,
                Transaction.batch_id == batch.id,
                Transaction.tenant_id == tenant_id,
                Transaction.status == "proposed",
            )
        ).scalar_one_or_none()
        if transaction is None:
            continue

        touched = False
        if edit.date is not None:
            transaction.date = edit.date
            touched = True
        if edit.amount is not None:
            transaction.amount = edit.amount
            touched = True
        if edit.kind is not None:
            transaction.kind = edit.kind
            touched = True
        if edit.extraction_confidence is not None:
            transaction.extraction_confidence = edit.extraction_confidence
            touched = True
        if edit.category is not None:
            transaction.category = resolved_category(edit.category)
            touched = True
        # Corrigir o comerciante tem de corrigir a IDENTIDADE junto — deixar a
        # chave antiga faria a linha corrigida continuar agrupando com o
        # comerciante errado, de forma invisível (a tela mostra `merchant`,
        # que já estaria certo).
        if edit.merchant is not None or edit.original_description is not None:
            if edit.merchant is not None:
                transaction.merchant = edit.merchant
            if edit.original_description is not None:
                transaction.original_description = edit.original_description
            transaction.merchant_key = merchant_key(
                original_description=transaction.original_description,
                merchant=transaction.merchant,
            )
            touched = True

        if touched:
            edited += 1

    removed = 0
    for transaction_id in remove_transaction_ids:
        transaction = session.execute(
            select(Transaction).where(
                Transaction.id == transaction_id,
                Transaction.batch_id == batch.id,
                Transaction.tenant_id == tenant_id,
                Transaction.status == "proposed",
            )
        ).scalar_one_or_none()
        if transaction is None:
            continue
        session.delete(transaction)
        removed += 1
    session.flush()

    added = 0
    for entry in add:
        session.add(
            Transaction(
                id=f"txn_{uuid.uuid4().hex[:20]}",
                tenant_id=tenant_id,
                batch_id=batch.id,
                source_document_id=batch.document_id,
                status="proposed",
                date=entry.date,
                original_description=entry.original_description,
                merchant=entry.merchant,
                merchant_key=merchant_key(
                    original_description=entry.original_description, merchant=entry.merchant
                ),
                amount=entry.amount,
                kind=entry.kind,
                category=resolved_category(entry.category) if entry.category else None,
                # Item acrescentado à mão não foi lido pelo extrator: a
                # confiança é da correção humana que o trouxe, e marcá-lo como
                # `alta` faria a fila de revisão perder de vista o que não
                # veio do documento.
                extraction_confidence="media",
                page=entry.page,
            )
        )
        added += 1
    session.flush()

    recomputed = recompute_batch_checksum(session, tenant_id, batch)

    return EditProposedBatchResult(
        batch_id=batch.id,
        transaction_count=recomputed.transaction_count,
        checksum=recomputed.checksum,
        applied=AppliedCounts(edited=edited, removed=removed, added=added),
        dropped_categories=sorted(dropped),
    )
