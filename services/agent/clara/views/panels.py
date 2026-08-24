"""O contrato de apresentação entre a Clara e a tela — porta de `packages/views/src/index.ts`.

O vocabulário é PEQUENO de propósito: um `kind` livre viraria o modelo
inventando layout a cada turno. Cada forma existe porque um caso de uso real a
pede. Proveniência é ESTRUTURAL (FR-016): toda linha cujo valor é soma de
lançamentos exige `transaction_ids`, e a validação falha fechado — um painel
sem proveniência é recusado antes de alcançar a interface, nunca desenhado com
um aviso depois.

Portado como um subconjunto fiel (metric, breakdown, comparison, transactions,
invoices, commitments, proposal, checksum) — o suficiente para o fluxo
principal (US1/US2/US3). `series` e `recurrences` entram quando o analista
precisar deles.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

Basis = Literal["sum", "delta", "projection", "document", "schedule", "count"]
Trend = Literal["up", "down", "flat"]
Accent = Literal["attention", "danger", "positive"]

Kind = Literal[
    "metric", "breakdown", "comparison", "transactions", "invoices",
    "commitments", "proposal", "checksum", "series", "recurrences",
]

# `sum` é o único valor que promete fechar com os próprios ids — por isso é o
# único que os exige. `document`: total que o documento declara (checksum,
# invoices — fato do documento, não agregação escolhida). `schedule`: um
# compromisso futuro que não saiu de lançamento nenhum. `projection`
# (recurrences): custo anualizado, uma PROJEÇÃO a partir das cobranças reais,
# não a soma delas — os ids provam a origem, a álgebra não fecha contra eles.
DEFAULT_BASIS: dict[Kind, Basis] = {
    "metric": "sum",
    "breakdown": "sum",
    "comparison": "sum",
    "transactions": "sum",
    "invoices": "document",
    "commitments": "schedule",
    "proposal": "sum",
    "checksum": "document",
    "series": "sum",
    "recurrences": "projection",
}


def basis_of(kind: Kind, basis: Basis | None) -> Basis:
    """A base efetiva de uma célula: o que ela declarou, ou o padrão da forma."""
    return basis if basis is not None else DEFAULT_BASIS[kind]


class Row(BaseModel):
    label: str = Field(
        min_length=1,
        description="Rótulo em português — use o `label` de uma tool, nunca o identificador cru.",
    )
    amount: int | None = None
    basis: Basis | None = None
    detail: str | None = None
    share: float | None = Field(default=None, ge=0, le=1)
    trend: Trend | None = None
    accent: Accent | None = None
    transaction_ids: list[str] = Field(default_factory=list)


class Metric(BaseModel):
    label: str = Field(min_length=1)
    amount: int | None = None
    text: str | None = None
    detail: str | None = None
    basis: Basis | None = None
    transaction_ids: list[str] = Field(default_factory=list)


class PanelBase(BaseModel):
    title: str = Field(min_length=1, description="Título curto, em português.")
    summary: str | None = None


def _states_money(entry: Row | Metric) -> bool:
    if entry.amount is not None:
        return True
    return isinstance(entry, Row) and (entry.share is not None or entry.trend is not None)


class MetricPanel(PanelBase):
    kind: Literal["metric"] = "metric"
    metric: Metric
    rows: list[Row] = Field(default_factory=list, max_length=20)


class BreakdownPanel(PanelBase):
    kind: Literal["breakdown"] = "breakdown"
    metric: Metric | None = None
    rows: list[Row] = Field(min_length=1, max_length=50)


class ComparisonPanel(PanelBase):
    kind: Literal["comparison"] = "comparison"
    metric: Metric | None = None
    rows: list[Row] = Field(min_length=1, max_length=50)


class TransactionsPanel(PanelBase):
    kind: Literal["transactions"] = "transactions"
    metric: Metric | None = None
    rows: list[Row] = Field(min_length=1, max_length=50)


class InvoicesPanel(PanelBase):
    """As faturas, uma por linha. Rows NÃO carregam proveniência: o total de
    uma fatura é fato do DOCUMENTO, não uma agregação de lançamentos."""

    kind: Literal["invoices"] = "invoices"
    rows: list[Row] = Field(min_length=1, max_length=30)


class CommitmentsPanel(PanelBase):
    """A agenda. Rows não carregam proveniência: um compromisso é um lembrete
    agendado, não um lançamento."""

    kind: Literal["commitments"] = "commitments"
    metric: Metric | None = None
    rows: list[Row] = Field(min_length=1, max_length=30)


class ProposalPanel(PanelBase):
    """O que a Clara PROPÕE mudar, antes de mudar. Não é o gate — quem abre a
    decisão é a tool correspondente."""

    kind: Literal["proposal"] = "proposal"
    metric: Metric | None = None
    rows: list[Row] = Field(min_length=1, max_length=50)


class ChecksumPanel(PanelBase):
    """A conferência (FR-016 exceção: fato do documento, não soma escolhida).

    `declared_total` e `difference` são nuláveis porque o domínio permite
    fatura sem total declarado — exigir número forçaria a Clara a inventar 0.
    """

    kind: Literal["checksum"] = "checksum"
    batch_id: str = Field(min_length=1)
    declared_total: int | None
    extracted_total: int
    difference: int | None
    result: Literal["match", "mismatch", "no_declared_total"]
    cause: str | None = None
    rows: list[Row] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def _consistent_result(self) -> ChecksumPanel:
        expected_difference = (
            None if self.declared_total is None else self.extracted_total - self.declared_total
        )
        if self.difference != expected_difference:
            raise ValueError("difference deve ser extracted_total - declared_total")

        result_ok = (
            (self.result == "match" and self.difference == 0)
            or (
                self.result == "mismatch"
                and self.declared_total is not None
                and self.difference is not None
                and self.difference != 0
            )
            or (
                self.result == "no_declared_total"
                and self.declared_total is None
                and self.difference is None
            )
        )
        if not result_ok:
            raise ValueError("result não corresponde aos totais da conferência")
        return self


class SeriesPanel(PanelBase):
    """Uma série no tempo — um mês, uma fatura, um período por linha. As
    linhas AQUI por acaso somam o destaque (os períodos são disjuntos); em
    `analyze_financial_series` o destaque é a diferença entre o primeiro e o
    último ponto, e por isso aquele caso usa `comparison`, não `series`."""

    kind: Literal["series"] = "series"
    metric: Metric | None = None
    rows: list[Row] = Field(min_length=1, max_length=50)


class RecurrencesPanel(PanelBase):
    """Cobranças recorrentes. Sem `metric`: não há um total único que resuma
    "todas as assinaturas" sem somar projeções de cadências diferentes."""

    kind: Literal["recurrences"] = "recurrences"
    rows: list[Row] = Field(min_length=1, max_length=50)


PanelUnion = (
    MetricPanel | BreakdownPanel | ComparisonPanel | TransactionsPanel
    | InvoicesPanel | CommitmentsPanel | ProposalPanel | ChecksumPanel
    | SeriesPanel | RecurrencesPanel
)
Panel = Annotated[PanelUnion, Field(discriminator="kind")]


class ProvenanceError(ValueError):
    """Painel sem proveniência — falha fechado, antes de alcançar a interface."""


def check_provenance(
    panel: MetricPanel
    | BreakdownPanel
    | ComparisonPanel
    | TransactionsPanel
    | CommitmentsPanel
    | ProposalPanel
    | SeriesPanel
    | RecurrencesPanel,
) -> list[str]:
    """As regras semânticas de proveniência, fora do schema — para poderem se
    explicar. Devolve mensagens acionáveis em vez de recusar em silêncio."""
    issues: list[str] = []
    kind: Kind = panel.kind  # type: ignore[assignment]

    metric = getattr(panel, "metric", None)
    if metric is not None and metric.amount is not None and basis_of(kind, metric.basis) == "sum":
        if len(metric.transaction_ids) == 0:
            issues.append(
                "metric.transaction_ids: uma métrica que soma lançamentos exige "
                "transaction_ids — ou declare metric.basis quando o valor não sai do razão"
            )

    about_entries = kind in ("transactions", "proposal")
    for index, row in enumerate(panel.rows):
        if basis_of(kind, row.basis) != "sum":
            continue
        if not _states_money(row) and not about_entries:
            continue
        if len(row.transaction_ids) > 0:
            continue
        issues.append(
            f"rows.{index}.transaction_ids: uma linha do razão exige transaction_ids — "
            'ou declare basis nesta linha ("document", "projection", "count") '
            "quando o valor não é soma de lançamentos"
        )

    return issues


def require_provenance(panel: Panel) -> Panel:
    """Ponto único de exigência (FR-016). Levanta `ProvenanceError` em vez de
    devolver um painel que a interface desenharia sem origem."""
    if isinstance(panel, (InvoicesPanel, ChecksumPanel)):
        return panel  # exceções declaradas: fato do documento, não soma.
    issues = check_provenance(panel)
    if issues:
        raise ProvenanceError("; ".join(issues))
    return panel
