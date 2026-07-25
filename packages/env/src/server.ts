import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

function getVercelOrigin() {
  const vercelUrl =
    process.env.VERCEL_ENV === "production"
      ? (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL)
      : (process.env.VERCEL_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (!vercelUrl) return undefined;
  return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
}

const vercelOrigin = getVercelOrigin();

const runtimeEnv = {
  ...process.env,
  // O Better-Auth deriva o base de rota do path desta URL, então o valor
  // público precisa ser igual ao mount do servidor (/api/auth em todo lugar).
  BETTER_AUTH_URL:
    process.env.BETTER_AUTH_URL ?? (vercelOrigin ? `${vercelOrigin}/api/auth` : undefined),
  APP_ORIGIN: process.env.APP_ORIGIN ?? vercelOrigin,
};

/**
 * Env do control plane (apps/web).
 *
 * A instância do agente (packages/agent) tem env próprio — TENANT_ID e a chave
 * pública para verificar os tokens emitidos aqui.
 */
export const env = createEnv({
  server: {
    // Banco do control plane: usuários, tenants, provisioning_jobs.
    DATABASE_URL: z.string().min(1),

    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),

    // Login com Google. Escopo fechado em openid/email/profile — qualquer
    // escopo de Gmail ou Drive exigiria verificação do app pelo Google.
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),

    // Origem pública do control plane; é também o `origin` do CORS do agente.
    APP_ORIGIN: z.url(),

    // Segredo com que o control plane assina os tokens de acesso ao agente.
    // MODO POOL (Etapas 0–3): HS256, segredo compartilhado com a instância.
    // ETAPA 4 (silo): troca por par ECDSA — o control plane assina com a
    // privada e cada instância verifica com a pública, sem segredo comum
    // entre N instâncias.
    AGENT_TOKEN_SECRET: z.string().min(32),

    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
