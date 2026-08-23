"""extract_pdf_text() contra PDFs reais — sem mock, o parser de verdade."""

from __future__ import annotations

import os

import pytest

from clara.tools.pdf import PdfPasswordRequiredError, extract_pdf_text

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def test_extracts_text_from_unprotected_pdf() -> None:
    result = extract_pdf_text(os.path.join(FIXTURES, "sample.pdf"))
    assert result.total_pages == 1
    assert "Fatura Teste 123,45" in result.pages[0].text


def test_protected_pdf_without_password_raises() -> None:
    with pytest.raises(PdfPasswordRequiredError):
        extract_pdf_text(os.path.join(FIXTURES, "protected.pdf"))


def test_protected_pdf_with_correct_password_opens() -> None:
    result = extract_pdf_text(os.path.join(FIXTURES, "protected.pdf"), password="segredo123")
    assert result.total_pages == 1


def test_protected_pdf_with_wrong_password_raises() -> None:
    with pytest.raises(PdfPasswordRequiredError):
        extract_pdf_text(os.path.join(FIXTURES, "protected.pdf"), password="errada")


def test_page_range_is_respected() -> None:
    result = extract_pdf_text(os.path.join(FIXTURES, "sample.pdf"), from_page=1, to_page=1)
    assert len(result.pages) == 1
    assert result.pages[0].page == 1
