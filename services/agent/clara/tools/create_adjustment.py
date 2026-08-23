"""A linha de ajuste — porta de `agent/tools/create_adjustment.ts`.

O trigger `clara_transactions_immutable` recusa mudar valor, data ou natureza
de um lançamento confirmado, e a mensagem que ele devolve manda "registrar
um ajuste"; este é o caminho que faz essa frase ser verdade.

**É um DELTA, não uma substituição.** A linha original continua lá, intacta
— é o que o documento dizia; o ajuste soma por cima. Corrigir R$ 100,00 para
R$ 90,00 é um ajuste de −R$ 10,00, com as duas linhas visíveis. Substituir
apagaria a evidência do erro, que é justamente o que a auditoria precisa.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from clara.db.models import Batch, Transaction, new_id
from clara.ledger.checksum import ChecksumReport
from clara.ledger.money import format_cents
from clara.tools.errors import ToolError, not_found, refused
from clara.tools.recompute_batch_checksum import recompute_batch_checksum


@dataclass(frozen=True)
class AdjustmentResult:
    adjustment_id: str
    adjusts_transaction_id: str
    batch_id: str
    amount_cents: int
    amount_formatted: str
    original_amount_cents: int
    resulting_amount_cents: int
    resulting_amount_formatted: str
    audited_by: str
    checksum: ChecksumReport | None
    note: str


def create_adjustment(
    session: Session,
    tenant_id: str,
    user_id: str,
    *,
    transaction_id: str,
    amount_cents: int,
    reason: str,
    date: str | None = None,
) -> AdjustmentResult | ToolError:
    if amount_cents == 0:
        return refused(
            "operacao_nao_permitida",
            "Um ajuste de R$ 0,00 não corrige nada.",
            hint="Se a leitura já estava certa, use mark_reviewed em vez de um ajuste.",
        )

    original = session.execute(
        select(Transaction).where(
            Transaction.id == transaction_id, Transaction.tenant_id == tenant_id
        )
    ).scalar_one_or_none()
    if original is None:
        return not_found(
            "lancamento_nao_encontrado",
            f"Nenhum lançamento com o id {transaction_id}.",
            hint="Chame read_batch para pegar os ids desta fatura.",
        )

    # Ajustar rascunho seria criar duas linhas onde uma edição resolve — e
    # deixaria a conferência do lote sem fechar, porque o ajuste entra na
    # soma extraída e o documento não o declara.
    if original.status == "proposed":
        return refused(
            "operacao_nao_permitida",
            "Esta fatura ainda é rascunho: aqui a correção é direta, sem linha de ajuste.",
            hint="Chame edit_proposed_batch com o mesmo transaction_id.",
        )

    adjustment_id = new_id("txn")
    session.add(
        Transaction(
            id=adjustment_id,
            tenant_id=tenant_id,
            batch_id=original.batch_id,
            source_document_id=original.source_document_id,
            status="adjustment",
            adjusts_transaction_id=original.id,
            date=date or original.date,
            original_description=f"Ajuste: {reason}",
            merchant=original.merchant,
            # A identidade do comerciante é herdada de propósito: o ajuste tem
            # de agrupar com o gasto que corrige, ou "quanto gastei na
            # padaria" passa a ignorar a correção.
            merchant_key=original.merchant_key,
            amount=amount_cents,
            kind="adjustment",
            category=original.category,
            # Não foi lido de documento nenhum: veio de uma decisão humana.
            extraction_confidence="alta",
            reviewed_by=f"human:{user_id}",
        )
    )
    session.flush()

    # O ajuste entra na soma extraída, então pode FECHAR a divergência do
    # lote — sem reconferir aqui, a fatura já corrigida continuaria marcada
    # como divergente na fila de revisão e no snapshot do turno, para sempre.
    batch = session.execute(
        select(Batch).where(Batch.id == original.batch_id, Batch.tenant_id == tenant_id)
    ).scalar_one_or_none()
    recomputed = recompute_batch_checksum(session, tenant_id, batch) if batch is not None else None

    resulting_amount = original.amount + amount_cents
    return AdjustmentResult(
        adjustment_id=adjustment_id,
        adjusts_transaction_id=original.id,
        batch_id=original.batch_id,
        amount_cents=amount_cents,
        amount_formatted=format_cents(amount_cents),
        original_amount_cents=original.amount,
        resulting_amount_cents=resulting_amount,
        resulting_amount_formatted=format_cents(resulting_amount),
        audited_by=f"human:{user_id}",
        checksum=recomputed.checksum if recomputed is not None else None,
        note=(
            "A linha original continua no razão; o ajuste soma por cima. As duas aparecem na "
            "fatura. O campo checksum diz se a conferência da fatura fechou com o ajuste — se "
            "fechou, diga isso à pessoa."
        ),
    )
