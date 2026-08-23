"""Configuração do serviço, validada por Pydantic.

Espelha `packages/env/src/server.ts` na parte que o agent plane precisa: banco,
segredo do token, origem do control plane e modelo. Falhar cedo (import time)
é a mesma escolha que o `packages/env` já fazia em TypeScript — um valor
ausente deve derrubar o boot, não aparecer como erro obscuro no meio de um turno.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    """Papel de aplicação (`clara_app`), sem BYPASSRLS. Nunca o papel dono do schema."""

    agent_token_secret: str
    """Segredo HS256 compartilhado com o control plane para o JWT curto do agente."""

    app_origin: str = "http://localhost:3000"
    """Origem liberada no CORS e issuer esperado do token."""

    tenant_id: str | None = None
    """Definido em modo silo: um deployment por tenant."""

    clara_model: str = "gpt-5"
    clara_extractor_model: str = "gpt-5"
    clara_model_context_window_tokens: int = 400_000

    openai_api_key: str | None = None

    blob_read_write_token: str | None = None
    """Ausente em desenvolvimento: os PDFs então vêm do filesystem local."""


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()  # type: ignore[call-arg]
    return _settings
