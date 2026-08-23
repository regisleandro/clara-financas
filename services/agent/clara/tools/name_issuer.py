"""Nomeia a operadora de um documento — porta de `agent/tools/name_issuer.ts`.

O efeito é maior do que parece: enquanto o documento não tem emissor, TODAS
as transações dele caem na linha "Sem operadora" da visão cruzada por
operadora e mês — o emissor é do DOCUMENTO, não da linha. Uma escrita
resolve a fatura inteira.

Sem gate: não toca em valor, data nem categoria — é o nome de quem emitiu o
papel, e a pessoa acabou de dizê-lo.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Document
from clara.tools.errors import ToolError, not_found, refused
from clara.tools.issuer_canonical import canonical_issuer


@dataclass(frozen=True)
class NameIssuerResult:
    document_id: str
    previous_issuer: str | None
    issuer: str
    note: str | None = None


def name_issuer(
    session: Session, tenant_id: str, document_id: str, issuer: str
) -> NameIssuerResult | ToolError:
    issuer = issuer.strip()
    if issuer == "":
        return refused("operacao_nao_permitida", "O nome da operadora chegou vazio.")

    document = session.execute(
        select(Document).where(Document.tenant_id == tenant_id, Document.id == document_id)
    ).scalar_one_or_none()
    if document is None:
        return not_found(
            "documento_nao_encontrado",
            f"Nenhum documento com o id {document_id}.",
            hint="Os document_id aparecem em list_invoices e em read_batch.",
        )

    previous = document.issuer
    # "NUBANK" dito agora e "Nubank" gravado antes são a mesma operadora: a
    # grafia existente vence, para a matriz por operadora não ganhar duas
    # linhas da mesma casa.
    canonical = canonical_issuer(session, tenant_id, issuer)
    document.issuer = canonical

    return NameIssuerResult(
        document_id=document.id,
        previous_issuer=previous,
        issuer=canonical,
        note=(
            f'Grafia unificada com a operadora já registrada: "{canonical}".'
            if canonical != issuer
            else None
        ),
    )
