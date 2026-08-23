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

from clara.agents.coordinator import build_coordinator_team
from clara.settings import get_settings

settings = get_settings()

clara_team = build_coordinator_team()

agent_os = AgentOS(
    id="clara",
    name="Clara",
    teams=[clara_team],
    db=PostgresDb(db_url=settings.database_url, db_schema="agno"),
    interfaces=[AGUI(team=clara_team)],
    cors_allowed_origins=[settings.app_origin],
)

app = agent_os.get_app()

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
