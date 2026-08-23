"""Casos LITERAIS, portados de `packages/ledger/src/merchant.test.ts`.

Saíram de faturas Nubank reais, do mesmo cartão, em ciclos consecutivos — não
são exemplos inventados para o normalizador passar.
"""

from __future__ import annotations

from clara.ledger.merchant import cluster_merchant_keys, is_truncation_of, merchant_key


def key(original_description: str, merchant: str | None = None) -> str | None:
    return merchant_key(original_description=original_description, merchant=merchant)


class TestRuidoDoEmissor:
    def test_tira_a_mascara_do_cartao(self) -> None:
        assert key("•••• 0495 Est Villa Romana") == "est villa romana"
        assert key("**** 1234 Padaria Central") == "padaria central"

    def test_tira_a_cauda_de_conversao_de_moeda(self) -> None:
        maio = key("•••• 4851 Cursor, Ai Powered Ide USD 10.00 Conversão: USD 1 = R$ 5,26")
        junho = key("Cursor, Ai Powered Ide")
        assert maio == "cursor ai powered ide"
        assert maio == junho

    def test_tira_o_numero_da_parcela(self) -> None:
        setima = key("•••• 4851 Globo Globoplay - Parcela 7/12")
        oitava = key("Globo Globoplay - Parcela 8/12")
        assert setima == "globo globoplay"
        assert setima == oitava

    def test_desembrulha_o_iof(self) -> None:
        assert key('IOF de "Claude.Ai Subscription"') == "claude ai subscription"
        assert key('IOF de "Github, Inc."') == "github inc"

    def test_tira_o_prefixo_do_intermediario(self) -> None:
        assert key("Dl*Google Medium") == "google medium"
        assert key("Mp *Melimais") == "melimais"
        assert key("Pg *Vertex") == "vertex"

    def test_nao_depende_de_conhecer_o_intermediario(self) -> None:
        assert key("•••• 0052 Ec *Melimais") == key("Mp *Melimais")
        assert key("•••• 4851 Ppro *Microsoft") == key("Microsoft*Microsoft")
        assert key("•••• 4851 99app *99app") == "99app"
        assert key("Amazonmktplc*Lebrestor") == "lebrestor"

    def test_iof_de_cobranca_intermediada_casa_com_a_cobranca(self) -> None:
        assert key('IOF de "Openai *Chatgpt Subscr"') == key("•••• 4851 Openai *Chatgpt Subscr")

    def test_nao_come_descricao_com_asterisco_por_acaso(self) -> None:
        assert key("Melimais*") == "melimais"
        assert key("Promoção 2 * 1 na Padaria") == "promocao 2 1 na padaria"

    def test_tira_o_sufixo_do_arranjo_de_pagamento(self) -> None:
        assert key("Petlove - NuPay") == "petlove"
        assert key("iFood - NuPay") == "ifood"

    def test_normaliza_acento_e_pontuacao(self) -> None:
        assert key("Restaurante Açaí & Cia.") == "restaurante acai cia"

    def test_prefere_merchant_e_cai_na_descricao(self) -> None:
        assert key("•••• 0495 lixo ilegível", "Casa do Frango") == "casa do frango"
        assert key("Casa do Frango", "") == "casa do frango"
        assert key("Casa do Frango", None) == "casa do frango"

    def test_devolve_none_sem_identidade(self) -> None:
        assert key("") is None
        assert key("•••• 4851") is None


class TestTruncamento:
    def test_reconhece_o_corte(self) -> None:
        assert is_truncation_of("cursor ai powered", "cursor ai powered ide")
        assert is_truncation_of("transportes edemar rus", "transportes edemar russo")

    def test_nao_funde_comerciantes_que_so_compartilham_o_comeco(self) -> None:
        assert is_truncation_of("google youtube", "google medium") is False
        assert is_truncation_of("amazon prime canais", "amazon ad free for pri") is False
        assert is_truncation_of("posto shell", "posto ipiranga") is False

    def test_desconfia_de_ultimo_token_de_uma_letra(self) -> None:
        assert is_truncation_of("posto a", "posto amarelo") is False
        assert is_truncation_of("google mubi c", "google mubi curated c")


class TestAgrupamento:
    def test_mesmo_representante_independente_da_ordem(self) -> None:
        forward = cluster_merchant_keys(["google mubi c", "google mubi curated c"])
        backward = cluster_merchant_keys(["google mubi curated c", "google mubi c"])
        assert forward["google mubi curated c"] == "google mubi c"
        assert sorted(forward.items()) == sorted(backward.items())

    def test_funde_grafias_diferentes_com_apelido_aprovado(self) -> None:
        keys = ["claude ai subscription", "anthropic claude sub", "netflix com"]

        sem_apelido = cluster_merchant_keys(keys)
        assert len(set(sem_apelido.values())) == 3, "sozinha, ela não adivinha"

        com_apelido = cluster_merchant_keys(
            keys, [["claude ai subscription", "anthropic claude sub"]]
        )
        assert com_apelido["claude ai subscription"] == com_apelido["anthropic claude sub"]
        assert com_apelido["netflix com"] != com_apelido["anthropic claude sub"]

    def test_apelido_leva_o_grupo_inteiro(self) -> None:
        clustered = cluster_merchant_keys(
            ["google mubi c", "google mubi curated c", "mubi"],
            [["mubi", "google mubi c"]],
        )
        assert len(set(clustered.values())) == 1

    def test_apelido_com_chave_inexistente_nao_quebra(self) -> None:
        clustered = cluster_merchant_keys(["netflix com"], [["nao existe", "tambem nao"]])
        assert clustered["netflix com"] == "netflix com"

    def test_mantem_separados_comerciantes_parecidos(self) -> None:
        clustered = cluster_merchant_keys(["google youtube", "google medium", "google one"])
        assert len(set(clustered.values())) == 3

    def test_normaliza_cambio_em_qualquer_moeda(self) -> None:
        usd = merchant_key(original_description="Cursor, Ai Powered Ide USD 10.00")
        for currency in ["CAD", "JPY", "ARS", "CHF"]:
            assert (
                merchant_key(original_description=f"Cursor, Ai Powered Ide {currency} 10,00")
                == usd
            )

    def test_numero_no_fim_do_nome_nao_e_confundido_com_cambio(self) -> None:
        assert merchant_key(original_description="PADARIA SUL 2") != merchant_key(
            original_description="PADARIA"
        )

    def test_sufixo_de_meio_de_pagamento_sai(self) -> None:
        assert merchant_key(original_description="MERCADO CENTRAL - PIX") == merchant_key(
            original_description="MERCADO CENTRAL"
        )
        assert merchant_key(original_description="PADARIA - CENTRAL") != merchant_key(
            original_description="PADARIA"
        )
