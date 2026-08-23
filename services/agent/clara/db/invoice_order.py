"""'A última fatura' — uma definição só, para todo mundo que responde isso.

Porta de `packages/db/src/invoice-order.ts`. NULLS LAST é a definição certa:
um lote sem `period_end` (extração que não achou o ciclo, extrato, nota
fiscal) não é o mais recente — é o que não sabemos datar, e ordená-lo como se
fosse o mais novo afirmaria algo que o dado não diz. PostgreSQL usa NULLS
FIRST por padrão em `DESC`, então a exceção precisa ser explícita.
"""

from __future__ import annotations

from sqlalchemy import ColumnElement, nulls_last, text

from clara.db.models import Batch


def latest_invoice_order() -> list[ColumnElement]:
    return [
        nulls_last(text('"batches".period_end DESC')),
        Batch.created_at.desc(),
        # Desempate estável: sem ele, "a última fatura" muda sozinha entre turnos.
        Batch.id.desc(),
    ]


def oldest_invoice_order() -> list[ColumnElement]:
    """A mesma definição, do mais antigo para o mais novo — a leitura mês a mês.

    NULLS LAST nos dois sentidos: inverter a ordem não pode transformar
    "não sei quando" em "foi o primeiro".
    """
    return [
        nulls_last(text('"batches".period_end ASC')),
        Batch.created_at.asc(),
        Batch.id.asc(),
    ]
