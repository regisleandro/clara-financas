# O agente Python — `uvicorn` atrás de `AgentOS`. Deploy: T001-T002 previam
# este arquivo desde a Fase 1; construído tarde, na polida final, porque
# rodar o serviço de verdade (ver docs/ledger-python.md) importava mais do
# que empacotá-lo antes de saber que funcionava.
#
# `uv` gerencia dependências e venv — o mesmo lockfile que CI e
# desenvolvimento local usam, então a imagem instala exatamente o que os
# testes rodaram contra.
FROM python:3.12-slim AS base

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /uvx /bin/

WORKDIR /app

# Camada de dependências separada do código: editar `clara/` não invalida o
# cache de `uv sync`, que é o passo caro desta imagem.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY clara ./clara
COPY migrations ./migrations
COPY alembic.ini ./

RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# A migração é um passo EXPLÍCITO antes do primeiro boot num banco novo (ver
# "Preparar o banco" em docs/deploy.md) — a imagem nunca a roda sozinha no
# entrypoint, pelo mesmo motivo que `apps/web` não roda a dela: DDL aplicada
# sem revisão humana é o tipo de coisa que deveria custar um "sim", não
# acontecer no boot de um contêiner.
CMD ["uvicorn", "clara.os_app:app", "--host", "0.0.0.0", "--port", "8000"]
