"""Extração da camada de texto de um PDF — porta de `agent/lib/pdf.ts`.

Determinística e sem modelo: o que sai daqui é o que está no arquivo. Usa
`pypdf` no lugar do `unpdf`/pdf.js — mesma restrição da v1: só PDFs nativos
digitais, sem OCR.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx
from pypdf import PdfReader
from pypdf.errors import FileNotDecryptedError, PdfReadError

from clara.settings import get_settings


class PdfPasswordRequiredError(Exception):
    pass


@dataclass
class PdfPage:
    page: int
    text: str


@dataclass
class ExtractedPdf:
    total_pages: int
    pages: list[PdfPage]


def _load_pdf_bytes(blob_key: str) -> bytes:
    """Em desenvolvimento a chave é um caminho de arquivo; em produção é uma
    URL do Vercel Blob, gravada com acesso PRIVADO."""
    if blob_key.startswith("http://") or blob_key.startswith("https://"):
        token = get_settings().blob_read_write_token
        if not token:
            raise RuntimeError(
                "BLOB_READ_WRITE_TOKEN não está definida nesta instância do agente. "
                "Os documentos são privados e não podem ser lidos sem o token do store."
            )
        response = httpx.get(blob_key, headers={"Authorization": f"Bearer {token}"}, timeout=30)
        response.raise_for_status()
        return response.content

    with open(blob_key, "rb") as f:
        return f.read()


def extract_pdf_text(
    blob_key: str,
    *,
    password: str | None = None,
    from_page: int | None = None,
    to_page: int | None = None,
) -> ExtractedPdf:
    data = _load_pdf_bytes(blob_key)

    try:
        reader = PdfReader(data if hasattr(data, "read") else __import__("io").BytesIO(data))
        if reader.is_encrypted:
            if password is None:
                raise PdfPasswordRequiredError()
            if not reader.decrypt(password):
                raise PdfPasswordRequiredError()
    except FileNotDecryptedError as exc:
        raise PdfPasswordRequiredError() from exc
    except PdfReadError as exc:
        if "password" in str(exc).lower() or "encrypt" in str(exc).lower():
            raise PdfPasswordRequiredError() from exc
        raise

    total_pages = len(reader.pages)
    start = max(1, from_page or 1)
    end = min(total_pages, to_page or total_pages)

    pages = [
        PdfPage(page=i, text=(reader.pages[i - 1].extract_text() or "").strip())
        for i in range(start, end + 1)
    ]
    return ExtractedPdf(total_pages=total_pages, pages=pages)
