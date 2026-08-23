"""Como uma tool diz que não deu — porta de `agent/lib/errors.ts`.

Formato sempre `{"error": {"code", "message", "hint?", "retryable"}}`.
`message` é para a pessoa, em português; `hint` é para o modelo, e diz o
próximo passo executável — nunca uma frase solta que o modelo tem de
interpretar sozinho.
"""

from __future__ import annotations

from typing import Literal, TypedDict

ToolErrorCode = Literal[
    "lote_nao_encontrado", "lote_ja_decidido", "lote_ja_registrado",
    "documento_nao_encontrado", "documento_ja_registrado", "extracao_nao_encontrada",
    "rascunho_editado", "compromisso_nao_encontrado", "conceito_nao_encontrado",
    "categoria_desconhecida", "alcance_alterado", "recorte_incompleto",
    "lancamento_nao_encontrado", "nenhuma_alteracao", "operacao_nao_permitida",
    "credencial_invalida", "senha_necessaria",
    "proposta_nao_encontrada", "proposta_ja_decidida", "proposta_expirada",
    "proposta_desatualizada", "fatura_sem_divergencia",
    "referencia_de_fatura_nao_encontrada",
    "artefato_nao_encontrado", "artefato_expirado", "artefato_invalido",
    "painel_sem_proveniencia", "painel_nao_reconcilia",
]


class ToolErrorBody(TypedDict, total=False):
    code: ToolErrorCode
    message: str
    hint: str
    retryable: bool


class ToolError(TypedDict):
    error: ToolErrorBody


def tool_error(
    code: ToolErrorCode, message: str, *, hint: str | None = None, retryable: bool = True
) -> ToolError:
    body: ToolErrorBody = {"code": code, "message": message, "retryable": retryable}
    if hint is not None:
        body["hint"] = hint
    return {"error": body}


def not_found(code: ToolErrorCode, message: str, *, hint: str | None = None) -> ToolError:
    """Açúcar para o caso mais comum: o alvo do pedido não existe."""
    return tool_error(code, message, hint=hint, retryable=True)


def refused(code: ToolErrorCode, message: str, *, hint: str | None = None) -> ToolError:
    """O pedido é impossível no estado atual e nenhuma repetição resolve."""
    return tool_error(code, message, hint=hint, retryable=False)
