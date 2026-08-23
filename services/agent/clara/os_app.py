"""O ponto de entrada do serviço — porta de `agent/channels/eve.ts` + o
bootstrap que o `eve dev`/`eve deploy` fazia implicitamente.

Monta o `Team` da coordenadora sobre `AgentOS`, expõe a conversa por AG-UI
(`POST /agui`) e impõe autenticação por JWT verificado — o tenant nunca vem
do cliente, só da claim (FR-001). A ACL de posse de sessão (FR-003) é uma
segunda camada, sobre a autenticação de token: o JWT prova QUEM a pessoa é;
a ACL prova que ESTA sessão é dela.
"""

from __future__ import annotations

from agno.db.postgres import PostgresDb
from agno.os import AgentOS
from agno.os.interfaces.agui import AGUI
from agno.os.middleware import JWTMiddleware
from agno.os.middleware.jwt import INTERNAL_SCHEDULER_USER_ID
from fastapi import Request
from fastapi.responses import JSONResponse

from clara.agents.coordinator import build_coordinator_team
from clara.agents.reminders import sweep_due_dates
from clara.api.router import router as ledger_api_router
from clara.settings import get_settings
from clara.tools.tenant import CrossTenantCallError, UnauthenticatedTenantError

settings = get_settings()

clara_team = build_coordinator_team()

# `schedules/due_dates.ts` → `AgentOS(scheduler=True)`: a varredura diária de
# vencimentos vira um Schedule do Agno, registrado sob demanda (ver
# `_ensure_due_dates_schedule` abaixo) apontando para o endpoint interno logo
# adiante. O token é auto-gerado pelo próprio AgentOS quando ausente, e vale
# só para esta instância — scheduler e `JWTMiddleware` leem o MESMO
# `app.state.internal_service_token`, então não há segredo extra para gerir.
agent_os = AgentOS(
    id="clara",
    name="Clara",
    teams=[clara_team],
    db=PostgresDb(db_url=settings.database_url, db_schema="agno"),
    interfaces=[AGUI(team=clara_team)],
    cors_allowed_origins=[settings.app_origin],
    scheduler=True,
    scheduler_base_url=settings.scheduler_base_url,
)

app = agent_os.get_app()
app.include_router(ledger_api_router)


@app.post("/internal/schedules/due-dates")
async def _run_due_dates_sweep(request: Request) -> JSONResponse:
    """O alvo do Schedule diário — nunca chamado por um cliente comum.

    `AuthMiddleware` já autentica o token interno do scheduler antes de
    chegar aqui (é o mesmo mecanismo que protege o resto do AgentOS); esta
    checagem extra recusa até um JWT de usuário válido, porque a varredura
    cruza tenants — nenhuma pessoa autenticada deveria conseguir disparar isso.
    """
    if getattr(request.state, "user_id", None) != INTERNAL_SCHEDULER_USER_ID:
        return JSONResponse(status_code=403, content={"error": "internal endpoint"})

    result = sweep_due_dates()
    return JSONResponse(
        status_code=200,
        content={
            "today": result.today,
            "tenantsScanned": result.tenants_scanned,
            "created": len(result.created),
        },
    )


@app.on_event("startup")
def _ensure_due_dates_schedule() -> None:
    """Idempotente: só cria o Schedule na primeira vez que o processo sobe
    com um banco novo. `0 12 * * *` em UTC é 9h em São Paulo — a mesma
    conversão que `due_dates.ts` fazia para o cron da Vercel."""
    db = agent_os.db
    if db is None or not hasattr(db, "get_schedule_by_name"):
        return
    if db.get_schedule_by_name("due_dates") is not None:
        return

    from agno.scheduler.cron import compute_next_run

    db.create_schedule(
        {
            "id": "sched_due_dates",
            "name": "due_dates",
            "description": "Varredura diária de vencimentos e lembretes.",
            "method": "POST",
            "endpoint": "/internal/schedules/due-dates",
            "payload": None,
            "cron_expr": "0 12 * * *",
            "timezone": "UTC",
            "timeout_seconds": 300,
            "max_retries": 1,
            "retry_delay_seconds": 60,
            "enabled": True,
            "next_run_at": compute_next_run("0 12 * * *", "UTC"),
            "locked_by": None,
            "locked_at": None,
        }
    )


@app.exception_handler(UnauthenticatedTenantError)
async def _unauthenticated(request: Request, exc: UnauthenticatedTenantError) -> JSONResponse:
    return JSONResponse(status_code=401, content={"error": str(exc)})


@app.exception_handler(CrossTenantCallError)
async def _cross_tenant(request: Request, exc: CrossTenantCallError) -> JSONResponse:
    return JSONResponse(status_code=403, content={"error": str(exc)})

# `verify_audience`/`audience` são obrigatórios aqui: `audience_claim` sozinho
# só nomeia QUAL claim ler, não exige que ela bata com nada — sem os dois, um
# token emitido para qualquer outro público passava, porque o valor nunca era
# comparado (achado ao testar contra o app real, não suposto).
#
# `JWTMiddleware` não verifica `iss`: a checagem de emissor que o canal
# original (`agent/channels/eve.ts`) fazia contra `APP_ORIGIN` não tem
# equivalente aqui. Ver docs/ledger-python.md — é uma redução de superfície
# consciente, não um descuido, e audiência + segredo compartilhado continuam
# de pé como a defesa real.
app.add_middleware(
    JWTMiddleware,
    verification_keys=[settings.agent_token_secret],
    algorithm="HS256",
    user_id_claim="userId",
    dependencies_claims=["tenantId", "userId"],
    audience_claim="aud",
    audience="clara-agent",
    verify_audience=True,
)
