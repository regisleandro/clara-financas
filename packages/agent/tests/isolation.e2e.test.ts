import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { SignJWT } from "jose";

/**
 * Isolamento das camadas 1–3, contra o agente RODANDO.
 *
 * O teste de packages/db cobre a camada 5 (RLS). Este cobre o caminho que
 * chega até lá:
 *
 *   token do control plane -> AuthFn (verifica assinatura, iss, aud e confere
 *   o claim contra TENANT_ID) -> requireTenantCaller na tool -> forTenant
 *
 * Exige `eve dev` na porta 2000. Sem servidor, os casos são pulados em vez de
 * falharem — um teste de integração vermelho por falta de ambiente vira ruído
 * e as pessoas param de olhar.
 *
 * Nota sobre dev: com `localDev()` na cadeia, um token inválido não é barrado
 * na BORDA (o loopback é aceito) — quem recusa é o guard da tool, porque
 * localDev devolve `principalType: "local-dev"` e não `"user"`. Em produção,
 * sem localDev, a recusa acontece antes, com 401. As duas camadas existem
 * justamente para que nenhuma precise estar certa sozinha.
 */

const BASE = process.env.AGENT_BASE_URL ?? "http://127.0.0.1:2000";
const AUDIENCE = "clara-agent";
const PROMPT =
  "Chame a tool read_concept com bundle='constitution' e prefix='categories/'. Responda apenas com o número do count.";

const TENANT = process.env.PROBE_TENANT ?? "tnt_e2e_probe";
const USER = process.env.PROBE_USER ?? "usr_e2e_probe";

let available = false;
let secret: Uint8Array;
let issuer: string;

type Outcome = {
  httpStatus: number;
  count: number | null;
  toolError: string | null;
};

async function mint(options: {
  tenantId?: string;
  userId?: string;
  secret?: Uint8Array;
  audience?: string;
  issuer?: string;
}) {
  return new SignJWT({
    tenantId: options.tenantId ?? TENANT,
    userId: options.userId ?? USER,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(options.userId ?? USER)
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(options.secret ?? secret);
}

async function ask(token: string | null): Promise<Outcome> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE}/eve/v1/session`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message: PROMPT }),
  });

  if (!response.ok) return { httpStatus: response.status, count: null, toolError: null };

  const sessionId = response.headers.get("x-eve-session-id");
  const stream = await fetch(`${BASE}/eve/v1/session/${sessionId}/stream`, { headers });
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let count: number | null = null;
  let toolError: string | null = null;
  const deadline = Date.now() + 90_000;

  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim() === "") continue;
        let event: { type?: string; data?: Record<string, unknown> };
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }

        if (event.type === "action.result") {
          const result = event.data?.result as { output?: Record<string, unknown> } | undefined;
          const output = result?.output;
          if (output && typeof output.count === "number") count = output.count;
          if (event.data?.status === "failed" || output?.error !== undefined) {
            toolError = JSON.stringify(output ?? event.data);
          }
        }

        if (event.type === "session.waiting" || event.type === "turn.failed") {
          return { httpStatus: response.status, count, toolError };
        }
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }

  return { httpStatus: response.status, count, toolError };
}

describe("isolamento do agente (camadas 1–3)", () => {
  before(async () => {
    secret = new TextEncoder().encode(process.env.AGENT_TOKEN_SECRET ?? "");
    issuer = process.env.APP_ORIGIN ?? "http://localhost:3000";

    try {
      const health = await fetch(`${BASE}/eve/v1/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      available = health.ok && (process.env.AGENT_TOKEN_SECRET ?? "").length > 0;
    } catch {
      available = false;
    }

    if (!available) {
      console.log(
        `  (pulado: agente não respondeu em ${BASE}; rode \`pnpm dev\` em packages/agent)`,
      );
    }
  });

  it("token válido lê os conceitos do próprio tenant", async (t) => {
    if (!available) return t.skip();
    const outcome = await ask(await mint({}));
    assert.equal(outcome.toolError, null);
    assert.ok(
      outcome.count !== null && outcome.count > 0,
      `esperava conceitos para ${TENANT}; veio count=${outcome.count}`,
    );
  });

  it("token de outro tenant não enxerga nada", async (t) => {
    if (!available) return t.skip();
    const outcome = await ask(await mint({ tenantId: "tnt_intruso", userId: "usr_intruso" }));
    assert.equal(outcome.count, 0, "um tenant sem dados não pode ver os dados de outro");
  });

  it("sem token, a tool recusa (localDev não é usuário)", async (t) => {
    if (!available) return t.skip();
    const outcome = await ask(null);
    assert.match(String(outcome.toolError), /authenticated tenant user/i);
    assert.equal(outcome.count, null);
  });

  it("assinatura inválida não alcança dado", async (t) => {
    if (!available) return t.skip();
    const outcome = await ask(
      await mint({ secret: new TextEncoder().encode("x".repeat(64)) }),
    );
    assert.equal(outcome.count, null);
  });

  it("audience errada não alcança dado", async (t) => {
    if (!available) return t.skip();
    const outcome = await ask(await mint({ audience: "outra-audiencia" }));
    assert.equal(outcome.count, null);
  });

  it("issuer errado não alcança dado", async (t) => {
    if (!available) return t.skip();
    const outcome = await ask(await mint({ issuer: "https://atacante.example" }));
    assert.equal(outcome.count, null);
  });

  it("outro usuário do MESMO tenant não lê a sessão alheia (ACL de posse)", async (t) => {
    if (!available) return t.skip();

    // Usuário A cria a sessão e abre o stream (que registra a posse).
    const tokenA = await mint({});
    const created = await fetch(`${BASE}/eve/v1/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ message: "Oi" }),
    });
    assert.ok(created.ok, `criação da sessão falhou: ${created.status}`);
    const sessionId = created.headers.get("x-eve-session-id");
    assert.ok(sessionId, "sem x-eve-session-id na resposta");

    const streamA = await fetch(`${BASE}/eve/v1/session/${sessionId}/stream`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.ok(streamA.ok, "o dono precisa conseguir abrir o próprio stream");
    void streamA.body?.cancel().catch(() => {});

    // Usuário B, MESMO tenant, tenta ler a mesma sessão: o eve valida o token
    // (é válido), mas a ACL de agent_sessions recusa a posse.
    const tokenB = await mint({ userId: "usr_e2e_bisbilhoteiro" });
    const streamB = await fetch(`${BASE}/eve/v1/session/${sessionId}/stream`, {
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.equal(streamB.status, 403, "sessão de A lida por B deveria ser 403");
    void streamB.body?.cancel().catch(() => {});
  });
});
