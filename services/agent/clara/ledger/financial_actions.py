"""Invariante contábil da resolução de divergência de fatura — porta de
`agent/lib/financial-actions.ts`.

Fica fora do modelo e fora de `prepare`/`apply` de propósito: manter o sinal
num lugar só evita que cada camada reinvente a conta.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class InvoiceResolutionPlan:
    difference_before_cents: int
    adjustment_cents: int
    difference_after_expected_cents: int = 0


def invoice_resolution_plan(difference_cents: int | None) -> InvoiceResolutionPlan | None:
    """A diferença do checksum é `extraído - declarado`; o ajuste que fecha
    a conta é necessariamente o inverso."""
    if difference_cents is None or difference_cents == 0:
        return None
    return InvoiceResolutionPlan(
        difference_before_cents=difference_cents,
        adjustment_cents=-difference_cents,
    )
