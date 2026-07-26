import { getDb } from "@clara-financas/db";
import { agentSessions } from "@clara-financas/db/schema/agent-session";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { eq, sql } from "drizzle-orm";
import { eveChannel } from "eve/channels/eve";
import {
  ForbiddenError,
  extractBearerToken,
  localDev,
  verifyJwtHmac,
  type AuthFn,
} from "eve/channels/auth";

import { instanceTenantId } from "../lib/tenant";

/**
 * Canal HTTP do agente.
 *
 * Topologia: o agente NÃO é montado dentro do app Next (`withEve`). Roda como
 * deployment próprio e o navegador fala com ele cross-origin. Exigência do
 * modelo silo (um projeto Vercel por tenant), validada no spike da Etapa 0:
 * preflight e POST cross-origin funcionam, e origem não declarada é bloqueada.
 */

const AUDIENCE = "clara-agent";

function appOrigin(): string {
  const value = process.env.APP_ORIGIN ?? "http://localhost:3000";
  return value;
}

/**
 * Extrai o `:sessionId` da URL das rotas de sessão do eve.
 *
 * Cobre `POST /eve/v1/session/:id`, `GET /eve/v1/session/:id/stream` e
 * `POST /eve/v1/session/:id/cancel`. `session/reset` e o `POST /eve/v1/session`
 * de criação não carregam id — devolvem null e a ACL não se aplica.
 */
function sessionIdFromUrl(url: string): string | null {
  const match = /\/eve\/v1\/session\/([^/?#]+)(?:\/(?:stream|cancel))?(?:[?#]|$)/.exec(url);
  const id = match?.[1];
  if (id === undefined || id === "reset") return null;
  return decodeURIComponent(id);
}

/**
 * ACL de posse de sessão — a tabela `agent_sessions` finalmente imposta.
 *
 * O eve não faz isso ("route auth does not enforce session ownership"): sem a
 * verificação, um usuário autenticado que descubra o `sessionId` de outro lê a
 * conversa inteira e ainda posta `inputResponses` — aprova escritas em nome da
 * vítima. Com a retomada de sessão no cliente, os ids passam a viver no
 * localStorage do navegador, o que aumenta a superfície; a ACL deixa de ser
 * rede de segurança e vira requisito.
 *
 * Claim-on-first-use: a linha nasce no primeiro acesso com id (o `POST
 * /session` de criação não tem id na URL; o primeiro `GET /stream`, que o
 * cliente abre em seguida, registra a posse — janela de corrida minúscula e
 * aceitável). Cross-tenant aparece como "não encontrado" porque a RLS esconde
 * a linha, e o INSERT com tenant errado é bloqueado pelo WITH CHECK.
 *
 * Fail-closed: qualquer erro de banco vira Forbidden, nunca "deixa passar".
 */
async function assertSessionOwnership(
  sessionId: string,
  tenantId: string,
  userId: string,
): Promise<void> {
  let owner: { userId: string } | undefined;
  try {
    owner = await forTenant(
      tenantId,
      async (tx) => {
        await tx
          .insert(agentSessions)
          .values({ sessionId, tenantId, userId })
          .onConflictDoNothing();

        const [row] = await tx
          .select({ userId: agentSessions.userId })
          .from(agentSessions)
          .where(eq(agentSessions.sessionId, sessionId))
          .limit(1);

        if (row !== undefined && row.userId === userId) {
          await tx
            .update(agentSessions)
            .set({ lastSeenAt: sql`now()` })
            .where(eq(agentSessions.sessionId, sessionId));
        }
        return row;
      },
      getDb(),
    );
  } catch {
    throw new ForbiddenError({ message: "Session ownership could not be verified." });
  }

  if (owner === undefined || owner.userId !== userId) {
    throw new ForbiddenError({ message: "Session does not belong to this user." });
  }
}

/**
 * Camada 1 da defesa em profundidade: token do control plane com claim de
 * tenant, conferido contra a identidade desta instância.
 *
 * Um token válido do tenant B é recusado pela instância do A porque a
 * instância conhece a própria identidade por variável de ambiente — sem
 * lookup, sem tabela, sem depender de acerto de roteamento.
 *
 * Por que NÃO devolvemos `result.sessionAuth` direto (verificado no código do
 * eve 0.27.6, não suposto):
 *  - a estratégia jwt-hmac fixa `principalType: "service"`, então o guard
 *    canônico da doc (`principalType !== "user"` → recusa) rejeitaria tudo;
 *  - `principalId` vira `${iss}:${sub}` composto, não o userId puro.
 * Normalizamos aqui para a forma que `requireTenantCaller` espera.
 */
function tenantToken(): AuthFn<Request> {
  return async (request) => {
    const token = extractBearerToken(request.headers.get("authorization"));
    if (token === null) return null; // sem bearer: segue a cadeia (localDev)

    const secret = process.env.AGENT_TOKEN_SECRET;
    if (secret === undefined || secret.length === 0) {
      throw new ForbiddenError({ message: "Agent token verification is not configured." });
    }

    const result = await verifyJwtHmac(token, {
      algorithm: "HS256",
      audiences: [AUDIENCE],
      issuer: appOrigin(),
      secret,
    });
    if (!result.ok) return null;

    // Só claims string/string[] sobrevivem à projeção do eve — daí os guards.
    const attributes = result.sessionAuth.attributes;
    const tenantId = attributes.tenantId;
    const userId = attributes.userId;

    if (typeof tenantId !== "string" || typeof userId !== "string") {
      throw new ForbiddenError({ message: "Token is missing tenantId/userId claims." });
    }

    const instance = instanceTenantId();
    if (instance !== undefined && tenantId !== instance) {
      throw new ForbiddenError({ message: "Token tenant does not match this instance." });
    }

    // Posse de sessão: só nas rotas que carregam um id. Impõe a ACL descrita
    // em `agent_sessions` — o eve valida o token, não a posse.
    const sessionId = sessionIdFromUrl(request.url);
    if (sessionId !== null) {
      await assertSessionOwnership(sessionId, tenantId, userId);
    }

    return {
      attributes: { tenantId, userId },
      authenticator: "control-plane",
      issuer: appOrigin(),
      principalId: userId,
      principalType: "user",
      subject: userId,
    };
  };
}

export default eveChannel({
  cors: {
    origin: appOrigin(),
    methods: ["GET", "POST"],
    allowedHeaders: ["authorization", "content-type"],
  },
  auth: [
    tenantToken(),
    // Aberto em localhost para `eve dev` e o REPL; ignorado em produção.
    // NUNCA sozinho: confia no header Host. E como devolve
    // `principalType: "local-dev"`, o guard das tools recusa mesmo assim —
    // em dev o fluxo real de token é obrigatório para exercitar as tools.
    localDev(),
  ],
});
