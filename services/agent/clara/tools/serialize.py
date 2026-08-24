"""Resultado de tool sempre serializável — Agno espera dict/list/BaseModel/str.

As funções de domínio devolvem dataclasses (mais convenientes para o código
Python interno); esta camada, na fronteira com o `@tool`, converte para dict
puro em JSON. Datas viram ISO 8601; nada de objeto opaco chega ao modelo.

Também é o PONTO ÚNICO onde a proveniência é exigida (FR-016): todo painel
passa por aqui antes de alcançar o modelo, porque toda tool de painel já
termina com `to_tool_result(panel)` — inclusive as que devolvem mais de um,
uma chamada por painel (ver `aggregate_by_month_tool`, `analyze_series_tool`).
Um painel sem proveniência nunca chega à conversa; a tool recebe o erro
estruturado no lugar do painel.
"""

from __future__ import annotations

import dataclasses
from datetime import date, datetime
from typing import Any, cast

from pydantic import BaseModel

from clara.tools.errors import ToolError, refused
from clara.views.panels import PanelUnion, ProvenanceError, require_provenance


def _default(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    raise TypeError(f"não sei serializar {type(value)!r}")


def to_tool_result(value: Any) -> Any:
    """Converte o retorno de uma função de domínio para algo que o `@tool`
    consiga devolver ao modelo: dict puro, com datas em ISO 8601."""
    import json

    if isinstance(value, PanelUnion):
        try:
            require_provenance(value)
        except ProvenanceError as exc:
            error: ToolError = refused("painel_sem_proveniencia", str(exc))
            return error
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        raw = dataclasses.asdict(value)
        return json.loads(json.dumps(raw, default=_default))
    if isinstance(value, dict):
        return json.loads(json.dumps(value, default=_default))
    return value


def to_tool_dict(value: Any) -> dict[str, Any]:
    """`to_tool_result` para o caso comum de fronteira: uma tool cujo próprio
    domínio já garante retorno em formato de objeto (dataclass, `BaseModel`
    ou `ToolError`) — o `cast` documenta essa garantia em vez de deixar cada
    `@tool` declarar `-> dict` sem tipar o conteúdo (o que faria toda leitura
    de campo do retorno valer como `Any`, silenciosamente)."""
    return cast(dict[str, Any], to_tool_result(value))
