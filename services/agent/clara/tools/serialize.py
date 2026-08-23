"""Resultado de tool sempre serializável — Agno espera dict/list/BaseModel/str.

As funções de domínio devolvem dataclasses (mais convenientes para o código
Python interno); esta camada, na fronteira com o `@tool`, converte para dict
puro em JSON. Datas viram ISO 8601; nada de objeto opaco chega ao modelo.
"""

from __future__ import annotations

import dataclasses
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


def _default(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    raise TypeError(f"não sei serializar {type(value)!r}")


def to_tool_result(value: Any) -> Any:
    """Converte o retorno de uma função de domínio para algo que o `@tool`
    consiga devolver ao modelo: dict puro, com datas em ISO 8601."""
    import json

    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        raw = dataclasses.asdict(value)
        return json.loads(json.dumps(raw, default=_default))
    if isinstance(value, dict):
        return json.loads(json.dumps(value, default=_default))
    return value
