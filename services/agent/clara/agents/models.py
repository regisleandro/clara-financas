"""Resolução de modelo — porta de `agent/lib/models.ts`.

Mais simples que o original: o Python fala direto com o provedor (sem o
caminho do Vercel AI Gateway/OIDC, que é específico do deploy em Vercel).
`CLARA_MODEL` continua sem valor fixado no código — um default desatualizado
falha com mensagem obscura; aqui a ausência falha cedo e diz o que fazer.
"""

from __future__ import annotations

from agno.models.openai import OpenAIChat

from clara.settings import get_settings


def _resolve(model_id: str) -> OpenAIChat:
    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError(
            "OPENAI_API_KEY não está definida. Configure em services/agent/.env."
        )
    return OpenAIChat(id=model_id, api_key=settings.openai_api_key)


def coordinator_model() -> OpenAIChat:
    """Coordenadora e analista: conversa e agregação, modelo mais econômico."""
    return _resolve(get_settings().clara_model)


def extractor_model() -> OpenAIChat:
    """Extrator: lê o texto de faturas reais e devolve transações estruturadas."""
    return _resolve(get_settings().clara_extractor_model)
