"""A coordenadora — porta de `packages/agent/agent/agent.ts` (`defineAgent`)
como `Team` do Agno, com o extrator como membro delegado.

`respond_directly=False`: a coordenadora sempre fala com a pessoa; ela não
repassa a resposta crua de um membro (o mesmo espírito de "a conversa traduz
a execução" do README).
"""

from __future__ import annotations

from agno.team import Team

from clara.agents.extractor import build_extractor_agent
from clara.agents.models import coordinator_model
from clara.instructions.dynamic import coordinator_instructions
from clara.tools.commit_batch_tool import commit_batch_tool
from clara.tools.prepare_batch_registration_tool import prepare_batch_registration_tool
from clara.tools.propose_batch import propose_batch, propose_batch_from_extraction


def build_coordinator_team() -> Team:
    return Team(
        name="clara",
        model=coordinator_model(),
        members=[build_extractor_agent()],
        instructions=coordinator_instructions,
        tools=[
            propose_batch,
            propose_batch_from_extraction,
            prepare_batch_registration_tool,
            commit_batch_tool,
        ],
        respond_directly=False,
        markdown=False,
    )
