"""Casos portados de `packages/views/src/index.test.ts` — a exigência
estrutural de proveniência (FR-016), a que garante que todo número exibido
pode ser aberto até as transações que o compõem."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from clara.views.panels import (
    BreakdownPanel,
    ChecksumPanel,
    ComparisonPanel,
    InvoicesPanel,
    Metric,
    MetricPanel,
    ProposalPanel,
    ProvenanceError,
    Row,
    require_provenance,
)


def test_aceita_painel_de_metrica_completo() -> None:
    panel = MetricPanel(
        title="Gasto do mês",
        metric=Metric(label="Total", amount=1000, transaction_ids=["t1"]),
    )
    require_provenance(panel)


def test_recusa_valor_fracionado_dinheiro_e_centavo_inteiro() -> None:
    with pytest.raises(ValidationError):
        Row(label="Mercado", amount=10.5)  # type: ignore[arg-type]


def test_recusa_linha_financeira_sem_provenienca() -> None:
    panel = BreakdownPanel(title="Composição", rows=[Row(label="Mercado", amount=1000)])
    with pytest.raises(ProvenanceError):
        require_provenance(panel)


def test_conferencia_carrega_os_tres_totais_e_o_resultado() -> None:
    panel = ChecksumPanel(
        batch_id="bat_1",
        title="Conferência da fatura",
        declared_total=325162,
        extracted_total=325161,
        difference=-1,
        result="mismatch",
        cause="arredondamento de IOF",
    )
    assert panel.difference == -1


def test_conferencia_aceita_fatura_sem_total_declarado() -> None:
    panel = ChecksumPanel(
        batch_id="bat_1",
        title="Conferência da fatura",
        declared_total=None,
        extracted_total=325161,
        difference=None,
        result="no_declared_total",
    )
    assert panel.declared_total is None


def test_checksum_recusa_resultado_aritmeticamente_contraditorio() -> None:
    with pytest.raises(ValidationError):
        ChecksumPanel(
            batch_id="bat_1",
            title="Conferência",
            declared_total=325162,
            extracted_total=325161,
            difference=-1,
            result="match",  # deveria ser mismatch
        )


def test_invoices_nao_exige_provenencia_fato_do_documento() -> None:
    panel = InvoicesPanel(title="Faturas", rows=[Row(label="Nubank 09/02", amount=12000)])
    require_provenance(panel)  # não levanta


def test_proposta_exige_provenencia() -> None:
    panel = ProposalPanel(
        title="Categorias sugeridas",
        rows=[Row(label="Nuvem Digital", detail="Sem categoria → Assinaturas")],
    )
    with pytest.raises(ProvenanceError):
        require_provenance(panel)


def test_proposta_passa_com_transaction_ids() -> None:
    panel = ProposalPanel(
        title="Categorias sugeridas",
        summary="Três lançamentos sem categoria que parecem assinaturas.",
        rows=[
            Row(
                label="Nuvem Digital",
                detail="Sem categoria → Assinaturas",
                transaction_ids=["t1", "t2", "t3"],
            )
        ],
    )
    require_provenance(panel)


def test_ajuste_no_nivel_da_fatura_declara_basis_document() -> None:
    """`prepare_invoice_resolution` não tem linha culpada: o ajuste é da fatura."""
    panel = ProposalPanel(
        title="Ajuste para fechar a fatura",
        rows=[
            Row(
                label="Ajuste de arredondamento",
                amount=3,
                detail="diferença da fatura, sem item culpado",
                basis="document",
            )
        ],
    )
    require_provenance(panel)  # basis declarada sai da exigência


def test_comparison_exige_pelo_menos_uma_linha() -> None:
    with pytest.raises(ValidationError):
        ComparisonPanel(title="Maio contra junho", rows=[])
