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
from clara.tools.aggregate_by_category_tool import aggregate_by_category_tool
from clara.tools.aggregate_by_month_tool import aggregate_by_month_tool
from clara.tools.analyze_series_tool import analyze_series_tool
from clara.tools.apply_learned_rules_tool import (
    apply_learned_rules_preview_tool,
    apply_learned_rules_tool,
)
from clara.tools.commit_batch_tool import commit_batch_tool
from clara.tools.compare_periods_tool import compare_periods_tool
from clara.tools.create_adjustment_tool import create_adjustment_tool
from clara.tools.deactivate_commitment_tool import deactivate_commitment_tool
from clara.tools.detect_recurrences_tool import detect_recurrences_tool
from clara.tools.edit_proposed_batch_tool import edit_proposed_batch_tool
from clara.tools.list_commitments_tool import list_commitments_tool
from clara.tools.list_documents_tool import list_documents_tool
from clara.tools.list_invoices_tool import list_invoices_tool
from clara.tools.list_notifications_tool import list_notifications_tool
from clara.tools.list_review_queue_tool import list_review_queue_tool
from clara.tools.mark_reviewed_tool import mark_reviewed_bulk_tool, mark_reviewed_tool
from clara.tools.name_issuer_tool import name_issuer_tool
from clara.tools.prepare_batch_registration_tool import prepare_batch_registration_tool
from clara.tools.propose_batch import propose_batch, propose_batch_from_extraction
from clara.tools.query_ledger_tool import query_ledger_tool
from clara.tools.read_batch_tool import read_batch_tool
from clara.tools.read_concept_history_tool import read_concept_history_tool
from clara.tools.read_concept_tool import read_concept_tool
from clara.tools.read_reclassifications_tool import read_reclassifications_tool
from clara.tools.read_tool_events_tool import read_tool_events_tool
from clara.tools.recategorize_transactions_tool import recategorize_transactions_tool
from clara.tools.reject_batch_tool import reject_batch_tool
from clara.tools.resolve_invoice_reference_tool import resolve_invoice_reference_tool
from clara.tools.save_commitment_tool import save_commitment_tool
from clara.tools.save_concept_tool import save_concept_tool
from clara.tools.set_proactivity_tool import set_proactivity_tool


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
            read_batch_tool,
            reject_batch_tool,
            list_invoices_tool,
            list_documents_tool,
            resolve_invoice_reference_tool,
            edit_proposed_batch_tool,
            # Analista (US2) — leitura pura, sem gate: nenhuma delas grava
            # nada, então não há razão para isolá-las num subagente à parte
            # (diferente do extrator, que precisa não herdar o contexto do
            # razão). Ver docs/ledger-python.md para a redução de escopo.
            query_ledger_tool,
            aggregate_by_category_tool,
            aggregate_by_month_tool,
            compare_periods_tool,
            analyze_series_tool,
            detect_recurrences_tool,
            # Fila de revisão (US3) — o mesmo predicado da tela e do
            # snapshot do turno (FR-020). `recategorize_transactions` e
            # `create_adjustment` passam pelo gate porque mudam o SENTIDO
            # do razão; `mark_reviewed`/`name_issuer` não, porque não
            # tocam em valor, data nem categoria confirmados.
            list_review_queue_tool,
            mark_reviewed_tool,
            mark_reviewed_bulk_tool,
            recategorize_transactions_tool,
            create_adjustment_tool,
            read_reclassifications_tool,
            name_issuer_tool,
            # Aprendizado, compromissos e avisos (US4). `save_concept` e
            # `save_commitment`/`deactivate_commitment` passam pelo gate: são
            # o SEGUNDO GATE (memória semântica) e o que autoriza a Clara a
            # falar primeiro, respectivamente. `apply_learned_rules` some em
            # duas tools porque Agno não tem confirmação condicional por
            # argumento — o preview é leitura pura, a aplicação é escrita.
            read_concept_tool,
            read_concept_history_tool,
            save_concept_tool,
            set_proactivity_tool,
            save_commitment_tool,
            list_commitments_tool,
            deactivate_commitment_tool,
            list_notifications_tool,
            apply_learned_rules_preview_tool,
            apply_learned_rules_tool,
            read_tool_events_tool,
        ],
        respond_directly=False,
        markdown=False,
    )
