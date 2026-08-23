"""O agente extrator — porta de `subagents/extractor/agent.ts` + `instructions.md`.

Isolado do razão por construção: só tem as ferramentas de leitura de PDF e de
escrita na staging descartável. Nunca vê a constituição nem o razão — o que
precisa (categorias válidas) viaja na requisição de delegação.
"""

from __future__ import annotations

from pathlib import Path

from agno.agent import Agent

from clara.agents.models import extractor_model
from clara.tools.extractor.save_extraction_tool import save_extraction_tool
from clara.tools.read_pdf_pages import read_pdf_pages
from clara.views.agent_contracts import ExtractionReceipt

INSTRUCTIONS = (Path(__file__).parent.parent / "instructions" / "extractor.md").read_text()


def build_extractor_agent() -> Agent:
    return Agent(
        name="extractor",
        model=extractor_model(),
        instructions=INSTRUCTIONS,
        tools=[read_pdf_pages, save_extraction_tool],
        output_schema=ExtractionReceipt,
        markdown=False,
    )
