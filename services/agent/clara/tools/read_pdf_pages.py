"""Lê a camada de texto de um PDF, página a página — `@tool` de fronteira.

Porta de `subagents/extractor/tools/read_pdf_pages.ts`. O documento é
buscado pelo id, sempre sob o escopo do tenant do chamador (FR-001).
Nenhum texto extraído é persistido por esta tool — quem persiste é
`save_extraction`, e só o que o extrator decidiu reter (FR-008).

A verificação de token de senha selado (`sealed-input`, TypeScript) não é
portada nesta fase: a senha chega em texto simples como argumento da tool.
É uma redução de escopo deliberada — ver docs/ledger-python.md — não um
descuido; a fronteira onde ela deveria ser reintroduzida é aqui.
"""

from __future__ import annotations

from agno.run.base import RunContext
from agno.tools import tool
from sqlalchemy import select

from clara.db.models import Document
from clara.db.tenant_scope import for_tenant
from clara.tools.errors import not_found, tool_error
from clara.tools.pdf import PdfPasswordRequiredError, extract_pdf_text
from clara.tools.serialize import to_tool_result
from clara.tools.tenant import require_tenant_caller


@tool(
    name="read_pdf_pages",
    description=(
        "Reads the text of an already-uploaded financial PDF, page by page. "
        "Use before extracting transactions. If the PDF is protected, ask the "
        "person for the password first."
    ),
)
def read_pdf_pages(
    run_context: RunContext,
    document_id: str,
    password: str | None = None,
    from_page: int | None = None,
    to_page: int | None = None,
) -> dict:
    caller = require_tenant_caller(run_context)

    with for_tenant(caller.tenant_id) as session:
        document = session.execute(
            select(Document).where(
                Document.id == document_id, Document.tenant_id == caller.tenant_id
            )
        ).scalar_one_or_none()

    if document is None:
        # Não distinguimos "não existe" de "é de outro tenant": a diferença
        # vazaria a existência de documentos alheios.
        return to_tool_result(
            not_found(
                "documento_nao_encontrado", "Nenhum documento com esse id.",
                hint="Use o document_id exatamente como veio na requisição da coordenadora.",
            )
        )

    try:
        extracted = extract_pdf_text(
            document.blob_key, password=password, from_page=from_page, to_page=to_page
        )
    except PdfPasswordRequiredError:
        return to_tool_result(
            tool_error(
                "senha_necessaria", "Este PDF é protegido por senha.",
                hint="Peça a senha à pessoa e repita a chamada com password preenchido.",
            )
        )

    return to_tool_result(
        {
            "document_id": document.id,
            "filename": document.filename,
            "issuer": document.issuer,
            "total_pages": extracted.total_pages,
            "pages": [{"page": p.page, "text": p.text} for p in extracted.pages],
        }
    )
