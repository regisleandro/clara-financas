"""Casos portados de `packages/ledger/src/issuer.test.ts`."""

from __future__ import annotations

from clara.ledger.issuer import UNKNOWN_ISSUER, issuer_key


def test_iguala_acento_e_caixa() -> None:
    assert issuer_key("Nubank") == issuer_key("NUBANK")
    assert issuer_key("Itaú") == issuer_key("itau")
    assert issuer_key("C6 Bank") == "c6-bank"


def test_espacamento_e_identidade() -> None:
    assert issuer_key("Nubank") != issuer_key("nu bank")


def test_distingue_operadoras_diferentes() -> None:
    assert issuer_key("Nubank") != issuer_key("Itaú")


def test_sem_operadora_tem_chave_propria() -> None:
    assert issuer_key(None) == UNKNOWN_ISSUER


def test_nome_descartado_nao_colide_com_sem_operadora() -> None:
    key = issuer_key("!!!")
    assert key != UNKNOWN_ISSUER
    assert key.startswith("operadora-")
