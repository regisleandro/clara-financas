import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * O MÍNIMO para falar com o banco: só a conexão.
 *
 * Existe porque `packages/db` importava `env/server`, que é o contrato do
 * CONTROL PLANE — e portanto exige `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID` e
 * `GOOGLE_CLIENT_SECRET`. Como o agente também usa `packages/db`, ele herdava
 * essa exigência e não subia sem credenciais de OAuth que não tem, não usa e
 * não deveria receber. Em desenvolvimento o sintoma ficava escondido atrás de
 * `SKIP_ENV_VALIDATION` no `.env` do agente; no primeiro build de verdade o
 * agente quebrou na avaliação da primeira tool que toca o banco.
 *
 * Dar os segredos ao agente resolveria o build e ampliaria o raio de dano de
 * um vazamento sem nenhum ganho. Desligar a validação esconderia a próxima
 * variável faltando. Separar o contrato conserta a causa: quem precisa do
 * banco declara o banco.
 *
 * O papel aqui é sempre o de APLICAÇÃO (`clara_app`, sem BYPASSRLS). O papel
 * dono do schema vive em `DATABASE_ADMIN_URL` e é usado só por migração e
 * manutenção — nunca por runtime.
 */
export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
