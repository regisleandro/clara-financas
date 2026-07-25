import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Env exposto ao navegador (Next.js → prefixo NEXT_PUBLIC_).
 *
 * O host do agente é público de propósito: o navegador fala direto com a
 * instância do tenant, cross-origin, autenticado por bearer de vida curta.
 * No modo silo este valor passa a vir do registry por tenant, não do env —
 * este default cobre as Etapas 0–3, em que há uma instância só.
 */
export const env = createEnv({
  clientPrefix: "NEXT_PUBLIC_",
  client: {
    NEXT_PUBLIC_AGENT_HOST: z.url(),
  },
  runtimeEnv: {
    NEXT_PUBLIC_AGENT_HOST: process.env.NEXT_PUBLIC_AGENT_HOST,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
