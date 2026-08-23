"""O serviço de ponta a ponta — AgentOS, AG-UI e JWTMiddleware, contra o
FastAPI real (nenhum mock), FR-001 e FR-004.

Achados reais durante a escrita deste teste, ambos corrigidos:
  - `coordinator_instructions` recebia `run_context=None` em rotas de
    metadados (GET /teams) e quebrava — precisa devolver as instruções
    estáticas nesse caso.
  - `audience_claim` sozinho NÃO faz o JWTMiddleware exigir o valor da
    audiência — sem `verify_audience=True` e `audience=...` explícitos, um
    token para qualquer outro público passava sem ser recusado.
"""

from __future__ import annotations

import time
import warnings

import jwt
import pytest
from fastapi.testclient import TestClient

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


def _token(secret: str, **claims: object) -> str:
    base: dict[str, object] = {
        "sub": "user_1", "tenantId": "tenant_a", "userId": "user_1", "aud": "clara-agent",
        "iat": int(time.time()), "exp": int(time.time()) + 300,
    }
    base.update(claims)
    return jwt.encode(base, secret, algorithm="HS256")


def test_health_is_public(client) -> None:  # noqa: ANN001
    http, _ = client
    assert http.get("/health").status_code == 200


def test_protected_route_requires_a_token(client) -> None:  # noqa: ANN001
    http, _ = client
    assert http.get("/teams").status_code == 401


def test_valid_token_is_accepted(client) -> None:  # noqa: ANN001
    http, os_app_module = client
    secret = os_app_module.settings.agent_token_secret
    r = http.get("/teams", headers={"Authorization": f"Bearer {_token(secret)}"})
    assert r.status_code == 200
    assert r.json()[0]["id"] == "clara"


def test_wrong_audience_is_rejected(client) -> None:  # noqa: ANN001
    http, os_app_module = client
    secret = os_app_module.settings.agent_token_secret
    r = http.get("/teams", headers={"Authorization": f"Bearer {_token(secret, aud='wrong')}"})
    assert r.status_code == 401


def test_tampered_signature_is_rejected(client) -> None:  # noqa: ANN001
    http, os_app_module = client
    secret = os_app_module.settings.agent_token_secret
    tampered = _token(secret)[:-3] + "xyz"
    r = http.get("/teams", headers={"Authorization": f"Bearer {tampered}"})
    assert r.status_code == 401


def test_token_signed_with_wrong_secret_is_rejected(client) -> None:  # noqa: ANN001
    http, _ = client
    forged = _token("a-completely-different-secret-value")
    r = http.get("/teams", headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 401
