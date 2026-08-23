"""As rotas de leitura (`clara/api/router.py`) contra o FastAPI real, com
Postgres real por trás — mesmo padrão de `test_os_app.py`."""

from __future__ import annotations

import time
import uuid
import warnings

import jwt
import pytest
from fastapi.testclient import TestClient

from clara.db.models import Batch, Document, Transaction
from clara.db.tenant_scope import for_tenant

warnings.filterwarnings("ignore", category=UserWarning)

pytestmark = pytest.mark.filterwarnings("ignore")


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch):  # noqa: ANN201
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-fake")
    from clara import settings as settings_module

    settings_module._settings = None

    import importlib

    import clara.os_app as os_app_module

    importlib.reload(os_app_module)
    return TestClient(os_app_module.app), os_app_module


def _token(secret: str, tenant_id: str, user_id: str = "user_1") -> str:
    payload = {
        "sub": user_id,
        "tenantId": tenant_id,
        "userId": user_id,
        "aud": "clara-agent",
        "iat": int(time.time()),
        "exp": int(time.time()) + 300,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def _seed(session, tenant: str, *, date: str, amount: int, category: str | None = None) -> None:  # noqa: ANN001
    doc_id = f"doc_{uuid.uuid4().hex}"
    batch_id = f"batch_{uuid.uuid4().hex}"
    txn_id = f"txn_{uuid.uuid4().hex}"
    session.add(
        Document(
            id=doc_id,
            tenant_id=tenant,
            kind="credit_card_invoice",
            blob_key="k",
            filename="f.pdf",
            content_hash=uuid.uuid4().hex,
            issuer="Nubank",
        )
    )
    session.flush()
    session.add(Batch(id=batch_id, tenant_id=tenant, document_id=doc_id, status="confirmed"))
    session.flush()
    session.add(
        Transaction(
            id=txn_id,
            tenant_id=tenant,
            batch_id=batch_id,
            status="confirmed",
            date=date,
            original_description="Loja",
            amount=amount,
            kind="purchase",
            category=category,
            extraction_confidence="alta",
            source_document_id=doc_id,
        )
    )
    session.flush()


def test_overview_requires_a_token(client) -> None:  # noqa: ANN001
    http, _ = client
    assert http.get("/api/ledger/overview").status_code == 401


def test_overview_returns_the_tenants_own_data(client, tenant_id: str) -> None:  # noqa: ANN001
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-01", amount=1000, category="groceries")

    http, os_app_module = client
    secret = os_app_module.settings.agent_token_secret
    r = http.get(
        "/api/ledger/overview", headers={"Authorization": f"Bearer {_token(secret, tenant_id)}"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["selectedMonth"] == "2026-06"
    assert body["total"] == 1000


def test_overview_never_leaks_another_tenants_data(
    client, tenant_id: str, other_tenant_id: str
) -> None:  # noqa: ANN001
    with for_tenant(other_tenant_id) as session:
        _seed(session, other_tenant_id, date="2026-06-01", amount=999_999)

    http, os_app_module = client
    secret = os_app_module.settings.agent_token_secret
    r = http.get(
        "/api/ledger/overview", headers={"Authorization": f"Bearer {_token(secret, tenant_id)}"}
    )
    assert r.status_code == 200
    assert r.json()["selectedMonth"] is None


def test_category_breakdown_matches_the_analyst_tool_shape(client, tenant_id: str) -> None:  # noqa: ANN001
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-01", amount=1000, category="groceries")

    http, os_app_module = client
    secret = os_app_module.settings.agent_token_secret
    r = http.get(
        "/api/ledger/category-breakdown?month=2026-06",
        headers={"Authorization": f"Bearer {_token(secret, tenant_id)}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "breakdown"
    assert body["rows"][0]["transaction_ids"]


def test_month_series_returns_a_list_of_panels(client, tenant_id: str) -> None:  # noqa: ANN001
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-01", amount=1000)

    http, os_app_module = client
    secret = os_app_module.settings.agent_token_secret
    r = http.get(
        "/api/ledger/month-series", headers={"Authorization": f"Bearer {_token(secret, tenant_id)}"}
    )
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list)
    assert body[0]["kind"] == "series"


def test_compare_two_months(client, tenant_id: str) -> None:  # noqa: ANN001
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-05-01", amount=1000)
        _seed(session, tenant_id, date="2026-06-01", amount=1500)

    http, os_app_module = client
    secret = os_app_module.settings.agent_token_secret
    r = http.get(
        "/api/ledger/compare?current_month=2026-06&previous_month=2026-05",
        headers={"Authorization": f"Bearer {_token(secret, tenant_id)}"},
    )
    assert r.status_code == 200
    assert r.json()["kind"] == "comparison"


def test_transactions_lists_rows(client, tenant_id: str) -> None:  # noqa: ANN001
    with for_tenant(tenant_id) as session:
        _seed(session, tenant_id, date="2026-06-01", amount=1000)

    http, os_app_module = client
    secret = os_app_module.settings.agent_token_secret
    r = http.get(
        "/api/ledger/transactions", headers={"Authorization": f"Bearer {_token(secret, tenant_id)}"}
    )
    assert r.status_code == 200
    assert r.json()["kind"] == "transactions"
