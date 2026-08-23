"""Memória semântica (US4) — porta dos casos reais de `save_concept.ts`,
`read_concept.ts`, `read_concept_history.ts`."""

from __future__ import annotations

from clara.db.tenant_scope import for_tenant
from clara.tools.read_concept import ReadConceptResult, read_concept
from clara.tools.read_concept_history import read_concept_history
from clara.tools.save_concept import SaveConceptResult, save_concept


def test_save_concept_creates_with_verified_by_human(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        result = save_concept(
            session,
            tenant_id,
            "user_1",
            concept_id="rules/mercado-sao-jose",
            concept_type="CategorizationRule",
            title="Mercado São José",
            merchant="mercado sao jose",
            body="Sempre [Mercado](/categories/groceries.md).",
        )

    assert isinstance(result, SaveConceptResult)
    assert result.action == "created"
    assert result.verified_by == "human:user_1"

    with for_tenant(tenant_id) as session:
        listed = read_concept(
            session, tenant_id, bundle="learnings", concept_id="rules/mercado-sao-jose"
        )

    assert listed.count == 1
    assert listed.concepts[0].body is not None
    assert "groceries" in listed.concepts[0].body


def test_save_concept_categorization_rule_requires_merchant(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        result = save_concept(
            session,
            tenant_id,
            "user_1",
            concept_id="rules/sem-merchant",
            concept_type="CategorizationRule",
            title="Sem merchant",
            body="[Mercado](/categories/groceries.md)",
        )

    assert isinstance(result, dict)
    assert result["error"]["code"] == "recorte_incompleto"


def test_save_concept_merchant_alias_requires_two_aliases(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        result = save_concept(
            session,
            tenant_id,
            "user_1",
            concept_id="merchants/anthropic",
            concept_type="MerchantAlias",
            title="Anthropic",
            body="Mesma empresa.",
        )

    assert isinstance(result, dict)
    assert result["error"]["code"] == "recorte_incompleto"


def test_save_concept_update_appends_to_verified_trail(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        save_concept(
            session,
            tenant_id,
            "user_1",
            concept_id="categories/pets",
            concept_type="Category",
            title="Pets",
            body="Categoria de pets.",
        )

    with for_tenant(tenant_id) as session:
        result = save_concept(
            session,
            tenant_id,
            "user_2",
            concept_id="categories/pets",
            concept_type="Category",
            title="Pets e Vet",
            body="Categoria de pets, agora incluindo veterinário.",
            reason="ampliando escopo",
        )

    assert isinstance(result, SaveConceptResult)
    assert result.action == "updated"

    with for_tenant(tenant_id) as session:
        history = read_concept_history(session, tenant_id, concept_id="categories/pets")

    assert not isinstance(history, dict)
    assert history.count == 2
    assert history.revisions[0].current is True
    assert history.revisions[0].author == "human:user_2"
    assert history.revisions[1].author == "human:user_1"


def test_read_concept_omits_body_in_listing_but_includes_it_for_single(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        save_concept(
            session,
            tenant_id,
            "user_1",
            concept_id="categories/groceries",
            concept_type="Category",
            title="Mercado",
            body="corpo completo",
        )

    with for_tenant(tenant_id) as session:
        listing = read_concept(session, tenant_id, bundle="learnings", prefix="categories/")

    assert isinstance(listing, ReadConceptResult)
    assert listing.concepts[0].body is None

    with for_tenant(tenant_id) as session:
        single = read_concept(
            session, tenant_id, bundle="learnings", concept_id="categories/groceries"
        )

    assert single.concepts[0].body == "corpo completo"


def test_read_concept_history_refuses_unknown_concept(tenant_id: str) -> None:
    with for_tenant(tenant_id) as session:
        result = read_concept_history(session, tenant_id, concept_id="rules/nao-existe")

    assert isinstance(result, dict)
    assert result["error"]["code"] == "conceito_nao_encontrado"
