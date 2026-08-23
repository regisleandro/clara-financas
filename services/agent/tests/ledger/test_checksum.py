"""Casos portados de `packages/ledger/src/checksum.test.ts` — inclusive os
que vieram de faturas reais (48 lançamentos com 1 centavo do IOF, o IOF que
não fecha por 1 centavo em 7 linhas)."""

from __future__ import annotations

from clara.ledger.checksum import verify_checksum
from clara.ledger.money import format_cents, sum_amounts
from clara.ledger.types import TransactionLike

_counter = 0


def tx(**overrides: object) -> TransactionLike:
    global _counter
    _counter += 1
    base: TransactionLike = {
        "id": overrides.pop("id", f"t{_counter}"),  # type: ignore[arg-type]
        "amount": 1000,
        "kind": "purchase",
        "extraction_confidence": "alta",
        "page": 1,
    }
    base.update(overrides)  # type: ignore[arg-type]
    return base


class TestVerifyChecksum:
    def test_bate_quando_soma_iguala_total(self) -> None:
        report = verify_checksum(
            transactions=[tx(amount=2550), tx(amount=1200)], declared_total=3750
        )
        assert report.result == "match"
        assert report.extracted_total == 3750
        assert report.difference == 0
        assert report.suspect_items == []

    def test_desconta_estorno(self) -> None:
        report = verify_checksum(
            transactions=[tx(amount=10000), tx(amount=5000), tx(amount=-1000, kind="refund")],
            declared_total=14000,
        )
        assert report.result == "match"
        assert report.extracted_total == 14000

    def test_ignora_pagamento_da_fatura_anterior(self) -> None:
        sem_pagamento = verify_checksum(
            transactions=[tx(amount=10000), tx(amount=5000)], declared_total=15000
        )
        com_pagamento = verify_checksum(
            transactions=[tx(amount=10000), tx(amount=5000), tx(amount=-32516, kind="payment")],
            declared_total=15000,
        )
        assert sem_pagamento.result == "match"
        assert com_pagamento.result == "match"
        assert com_pagamento.extracted_total == sem_pagamento.extracted_total

    def test_pagamento_nao_entra_como_suspeito(self) -> None:
        report = verify_checksum(
            transactions=[
                tx(amount=10000, extraction_confidence="baixa"),
                tx(amount=-32516, kind="payment", extraction_confidence="baixa"),
            ],
            declared_total=12500,
        )
        assert report.result == "mismatch"
        assert all(item.amount != -32516 for item in report.suspect_items)

    def test_soma_encargos_como_despesa(self) -> None:
        report = verify_checksum(
            transactions=[tx(amount=10000), tx(amount=347, kind="fee")], declared_total=10347
        )
        assert report.result == "match"

    def test_acusa_divergencia_e_informa_tamanho(self) -> None:
        report = verify_checksum(transactions=[tx(amount=10000)], declared_total=12500)
        assert report.result == "mismatch"
        assert report.difference == -2500

    def test_aponta_primeiro_item_exatamente_a_diferenca(self) -> None:
        report = verify_checksum(
            transactions=[
                tx(id="alta-3000", amount=3000, extraction_confidence="alta"),
                tx(id="baixa-9999", amount=9999, extraction_confidence="baixa"),
                tx(id="alta-5000", amount=5000, extraction_confidence="alta"),
            ],
            declared_total=14999,
        )
        assert report.result == "mismatch"
        assert report.difference == 3000
        assert report.suspect_items[0].transaction_id == "alta-3000"
        assert "exatamente a diferença" in report.suspect_items[0].reason

    def test_sem_coincidencia_prioriza_menor_confianca(self) -> None:
        report = verify_checksum(
            transactions=[
                tx(id="alta", amount=5000, extraction_confidence="alta"),
                tx(id="media", amount=4000, extraction_confidence="media"),
                tx(id="baixa", amount=3000, extraction_confidence="baixa"),
            ],
            declared_total=99999,
        )
        assert [item.transaction_id for item in report.suspect_items] == ["baixa", "media"]

    def test_sem_total_declarado_e_caso_proprio(self) -> None:
        report = verify_checksum(transactions=[tx(amount=10000)], declared_total=None)
        assert report.result == "no_declared_total"
        assert report.declared_total is None
        assert report.difference is None
        assert report.suspect_items == []

    def test_lote_vazio_com_total_zero_bate(self) -> None:
        report = verify_checksum(transactions=[], declared_total=0)
        assert report.result == "match"
        assert report.extracted_total == 0

    def test_nao_aceita_tolerancia_por_padrao(self) -> None:
        report = verify_checksum(transactions=[tx(amount=10001)], declared_total=10000)
        assert report.result == "mismatch"
        assert report.difference == 1

    def test_respeita_tolerancia_explicita(self) -> None:
        report = verify_checksum(
            transactions=[tx(amount=10001)], declared_total=10000, tolerance_cents=1
        )
        assert report.result == "match"


class TestAritmeticaDeDinheiro:
    def test_soma_em_inteiros(self) -> None:
        total = sum_amounts([10, 20])
        assert total == 30
        assert isinstance(total, int)


class TestFormatCents:
    def test_formata_padrao_brl(self) -> None:
        assert format_cents(123456) == "R$ 1.234,56"
        assert format_cents(5000000) == "R$ 50.000,00"
        assert format_cents(-500) == "-R$ 5,00"


class TestCausaProvavel:
    def test_classifica_poucos_centavos_em_muitos_itens_como_arredondamento(self) -> None:
        many = [tx(amount=1000) for _ in range(48)]
        report = verify_checksum(transactions=many, declared_total=48000 + 1)
        assert report.result == "mismatch"
        assert report.likely_cause == "rounding"
        assert report.suspect_items == []

    def test_folga_viaja_no_relatorio(self) -> None:
        many = [tx(amount=1000) for _ in range(48)]
        report = verify_checksum(transactions=many, declared_total=48000 + 1)
        assert report.tolerance == {"cents": 24, "item_count": 48}

    def test_limite_conhecido_folga_cresce_com_itens(self) -> None:
        many = [tx(amount=1000) for _ in range(48)]
        report = verify_checksum(transactions=many, declared_total=48000 + 20)
        assert report.likely_cause == "rounding"
        assert report.suspect_items == []
        assert report.tolerance is not None and report.tolerance["cents"] == 24
        assert report.difference == -20

    def test_fatura_pequena_nao_ganha_folga_proporcional(self) -> None:
        report = verify_checksum(
            transactions=[tx(amount=1000), tx(amount=1000)], declared_total=2000 - 20
        )
        assert report.likely_cause != "rounding"
        assert report.tolerance is None
        assert len(report.suspect_items) > 0

    def test_classifica_coincidencia_exata_como_item(self) -> None:
        report = verify_checksum(
            transactions=[tx(id="culpado", amount=3), tx(amount=1000)], declared_total=1000
        )
        assert report.likely_cause == "item"
        assert report.suspect_items[0].transaction_id == "culpado"

    def test_divergencia_grande_nao_e_arredondamento(self) -> None:
        report = verify_checksum(transactions=[tx(amount=10000)], declared_total=50000)
        assert report.likely_cause == "unknown"
        assert len(report.suspect_items) > 0


class TestLocalizacaoDaDivergencia:
    def test_aponta_iof_quando_subtotal_nao_fecha(self) -> None:
        report = verify_checksum(
            transactions=[
                tx(amount=100000),
                tx(amount=1990, kind="fee"),
                tx(amount=1526, kind="fee"),
            ],
            declared_total=103517,
            declared_subtotals={"fees": 3517, "purchases": 100000},
        )
        assert report.result == "mismatch"
        assert report.localized_in is not None
        assert report.localized_in.area == "fees"
        assert report.localized_in.declared == 3517
        assert report.localized_in.extracted == 3516

    def test_nao_inventa_localizacao_sem_subtotais(self) -> None:
        report = verify_checksum(transactions=[tx(amount=10000)], declared_total=10001)
        assert report.localized_in is None

    def test_nao_aponta_area_que_fecha(self) -> None:
        report = verify_checksum(
            transactions=[tx(amount=9999), tx(amount=500, kind="fee")],
            declared_total=10500,
            declared_subtotals={"fees": 500, "purchases": 10000},
        )
        assert report.localized_in is not None
        assert report.localized_in.area == "purchases"
