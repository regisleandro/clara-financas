"""A varredura diária de vencimentos — porta de `agent/lib/reminders.ts` +
`agent/schedules/due_dates.ts`.

Modo pool: uma instância atende todos os tenants, então a varredura itera
tenants EXPLICITAMENTE e abre um escopo por vez — nunca há uma consulta
"global", que furaria o isolamento justamente no caminho automatizado, que é
o menos observado. `tenants` não tem RLS (é o registro do control plane, não
conteúdo de tenant), então é lido fora de qualquer escopo `for_tenant`.

Não usa markdown/task mode: a varredura é determinística, e o modelo só
entra depois, quando a pessoa abre a conversa e pergunta pelos avisos
(`list_notifications`) ou pelos vencimentos (`list_commitments`). Decidir a
quem avisar não é o tipo de coisa que deveria depender de interpretação.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select

from clara.db.models import Commitment, Notification, Tenant
from clara.db.session import get_sessionmaker
from clara.db.tenant_scope import for_tenant
from clara.instructions.dates import days_until, next_occurrence, today_in_sao_paulo
from clara.knowledge.proactivity import proactivity_enabled
from clara.ledger.money import format_cents


@dataclass(frozen=True)
class CreatedReminder:
    tenant_id: str
    title: str
    due_date: str
    days_until: int


@dataclass(frozen=True)
class SweepResult:
    today: str
    tenants_scanned: int
    created: list[CreatedReminder] = field(default_factory=list)


def _ready_tenant_ids() -> list[str]:
    session = get_sessionmaker()()
    try:
        return list(
            session.execute(select(Tenant.id).where(Tenant.status == "ready")).scalars().all()
        )
    finally:
        session.close()


def sweep_due_dates(today: str | None = None) -> SweepResult:
    today_value = today or today_in_sao_paulo()
    tenant_ids = _ready_tenant_ids()
    created: list[CreatedReminder] = []

    for tenant_id in tenant_ids:
        with for_tenant(tenant_id) as session:
            # A metade consentimento: quem desligou os avisos automáticos
            # (`set_proactivity`) não recebe nada, por mais relevante que o
            # vencimento seja.
            if not proactivity_enabled(session, tenant_id):
                continue

            rows = (
                session.execute(
                    select(Commitment).where(
                        Commitment.tenant_id == tenant_id, Commitment.active == "yes"
                    )
                )
                .scalars()
                .all()
            )

            for row in rows:
                remaining = days_until(today_value, row.due_date)

                # Fora da janela de aviso ainda; nada a fazer.
                if remaining > row.remind_days_before:
                    continue

                # Já avisamos deste vencimento. A entrega do scheduler é
                # at-least-once, e sem esta marca a pessoa receberia o mesmo
                # aviso a cada execução.
                if row.last_notified_for == row.due_date:
                    # Vencimento passou e é recorrente: avança para o próximo
                    # ciclo.
                    if remaining < 0 and row.recurrence_day_of_month is not None:
                        row.due_date = next_occurrence(today_value, row.recurrence_day_of_month)
                    continue

                valor = (
                    ""
                    if row.expected_amount is None
                    else f" de {format_cents(row.expected_amount)}"
                )
                if remaining < 0:
                    dias = abs(remaining)
                    quando = f"venceu há {dias} {'dia' if dias == 1 else 'dias'}"
                elif remaining == 0:
                    quando = "vence hoje"
                else:
                    quando = f"vence em {remaining} {'dia' if remaining == 1 else 'dias'}"

                session.add(
                    Notification(
                        tenant_id=tenant_id,
                        kind="due_date",
                        title=f"{row.title} {quando}.",
                        body=(
                            f"{row.title}{valor} {quando} ({row.due_date}). "
                            "Quer revisar antes de pagar?"
                        ),
                        commitment_id=row.id,
                        created_by="process:due_dates",
                    )
                )
                row.last_notified_for = row.due_date

                created.append(
                    CreatedReminder(
                        tenant_id=tenant_id,
                        title=row.title,
                        due_date=row.due_date,
                        days_until=remaining,
                    )
                )

    return SweepResult(today=today_value, tenants_scanned=len(tenant_ids), created=created)
