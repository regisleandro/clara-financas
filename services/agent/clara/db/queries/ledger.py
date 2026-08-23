"""Consulta do razão para as análises — porta de `agent/lib/ledger-query.ts`.

Por padrão só o que está CONFIRMADO (mais ajuste): análise sobre lote não
aprovado apresentaria como fato algo que a pessoa ainda não decidiu. Fatura
em conferência é a exceção deliberada — ver `include_proposed` no chamador
(`clara/tools/analysis_scope.py`).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from sqlalchemy import and_, false, func, or_, select
from sqlalchemy.orm import Session

from clara.db.models import Document, Transaction
from clara.ledger.issuer import issuer_key
from clara.ledger.types import Confidence, EntryKind, LedgerEntry


def _search_terms(search: str) -> list[str]:
    """Divide a busca em termos; casar qualquer um já traz a linha. Termos
    com menos de 3 letras são ruído — devolver o razão inteiro por engano
    seria pior do que devolver nada, porque parece uma resposta."""
    normalized = unicodedata.normalize("NFD", search.lower())
    plain = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return [term for term in re.split(r"[^a-z0-9]+", plain) if len(term) >= 3]


def _unaccent_lower(column) -> object:
    """Mesma comparação sem acento e sem caixa do lado do banco — `translate`
    é função nativa e imutável, funciona em qualquer Postgres gerenciado."""
    accented = "áàâãäéèêëíìîïóòôõöúùûüçñ"
    plain = "aaaaaeeeeiiiiooooouuuucn"
    return func.translate(func.lower(func.coalesce(column, "")), accented, plain)


@dataclass(frozen=True)
class LedgerFilter:
    from_: str | None = None
    to: str | None = None
    batch_id: str | None = None
    include_proposed: bool = False
    ids: list[str] | None = None
    search: str | None = None
    kinds: list[EntryKind] | None = None
    confidences: list[Confidence] | None = None
    reviewed: bool | None = None
    category: str | None = None
    has_category: bool | None = None
    issuer: str | None = None


def load_ledger(
    session: Session, tenant_id: str, filter: LedgerFilter | None = None
) -> list[LedgerEntry]:
    filter = filter if filter is not None else LedgerFilter()
    statuses = (
        ["confirmed", "adjustment", "proposed"]
        if filter.include_proposed
        else ["confirmed", "adjustment"]
    )

    conditions = [Transaction.tenant_id == tenant_id, Transaction.status.in_(statuses)]
    if filter.from_ is not None:
        conditions.append(Transaction.date >= filter.from_)
    if filter.to is not None:
        conditions.append(Transaction.date <= filter.to)
    if filter.batch_id is not None:
        conditions.append(Transaction.batch_id == filter.batch_id)
    if filter.ids is not None:
        conditions.append(Transaction.id.in_(filter.ids))
    if filter.kinds:
        conditions.append(Transaction.kind.in_(filter.kinds))
    if filter.confidences:
        conditions.append(Transaction.extraction_confidence.in_(filter.confidences))
    if filter.reviewed is not None:
        conditions.append(
            Transaction.reviewed_at.is_not(None)
            if filter.reviewed
            else Transaction.reviewed_at.is_(None)
        )
    if filter.category is not None:
        conditions.append(Transaction.category == filter.category)
    if filter.has_category is not None:
        conditions.append(
            Transaction.category.is_not(None)
            if filter.has_category
            else Transaction.category.is_(None)
        )
    if filter.search is not None:
        terms = _search_terms(filter.search)
        matches = [
            m
            for term in terms
            for m in (
                _unaccent_lower(Transaction.original_description).like(f"%{term}%"),
                _unaccent_lower(Transaction.merchant).like(f"%{term}%"),
            )
        ]
        conditions.append(or_(*matches) if matches else false())
    if filter.issuer is not None:
        # A grafia do banco não é a grafia da pergunta: resolve-se por
        # `issuer_key`, comparando em Python sobre os documentos do tenant
        # (poucos, por construção — um por fatura).
        wanted = issuer_key(filter.issuer)
        docs = session.execute(
            select(Document.id, Document.issuer).where(Document.tenant_id == tenant_id)
        ).all()
        matching = [doc_id for doc_id, issuer in docs if issuer_key(issuer) == wanted]
        conditions.append(Transaction.source_document_id.in_(matching) if matching else false())

    rows = session.execute(
        select(Transaction, Document.issuer)
        .join(Document, Document.id == Transaction.source_document_id)
        .where(and_(*conditions))
        # Ordem estável (data recente primeiro, id como desempate): quem
        # trunca com LIMIT precisa que duas chamadas iguais mostrem as MESMAS
        # linhas.
        .order_by(Transaction.date.desc(), Transaction.id.desc())
    ).all()

    return [
        LedgerEntry(
            id=t.id,
            date=t.date,
            amount=t.amount,
            kind=t.kind,
            category=t.category,
            merchant=t.merchant,
            merchant_key=t.merchant_key,
            original_description=t.original_description,
            extraction_confidence=t.extraction_confidence,
            status=t.status,
            source_document_id=t.source_document_id,
            page=t.page,
            issuer=issuer,
        )
        for t, issuer in rows
    ]


@dataclass(frozen=True)
class LedgerCoverage:
    count: int
    first_date: str | None
    last_date: str | None


def ledger_coverage(session: Session, tenant_id: str) -> LedgerCoverage:
    """Que períodos o razão de fato cobre — serve para responder vazio de
    forma útil: um recorte sem dados é ambíguo (razão vazio, ou pergunta
    mirou o mês errado?) sem essa informação."""
    row = session.execute(
        select(func.count(), func.min(Transaction.date), func.max(Transaction.date)).where(
            Transaction.tenant_id == tenant_id, Transaction.status.in_(["confirmed", "adjustment"])
        )
    ).one()
    return LedgerCoverage(count=row[0], first_date=row[1], last_date=row[2])
