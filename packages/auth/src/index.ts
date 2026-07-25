import { createDb } from "@clara-financas/db";
import * as schema from "@clara-financas/db/schema/auth";
import { env } from "@clara-financas/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export function createAuth() {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    trustedOrigins: [env.APP_ORIGIN],
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: {
      // Escopo deliberadamente mínimo: openid/email/profile são NÃO sensíveis,
      // então não há processo de verificação do app pelo Google. Qualquer
      // escopo de Gmail ou Drive mudaria isso (consentimento verificado +
      // auditoria anual) — ver "Fora de escopo" no plano.
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        scope: ["openid", "email", "profile"],
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        // `lax`, não `none`: o cookie serve SÓ ao control plane, que é mesma
        // origem. A conversa com a instância do agente é cross-origin mas
        // autenticada por bearer, nunca por cookie.
        sameSite: "lax",
        secure: env.NODE_ENV === "production",
        httpOnly: true,
      },
    },
    plugins: [],
  });
}

/**
 * Singleton preguiçoso.
 *
 * Instanciar no escopo do módulo faria o Better-Auth exigir env já em tempo de
 * import — o que quebra o build do Next, que importa a rota para analisá-la
 * antes de qualquer requisição existir.
 */
let cached: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  cached ??= createAuth();
  return cached;
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
