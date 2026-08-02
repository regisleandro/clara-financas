// O CLI do eve documenta que "every command first loads .env/.env.local", mas
// na prática (v0.27.6) as variáveis NÃO estão disponíveis quando os módulos
// autorados são avaliados — `eve info` falha com o .env presente e funciona com
// a variável inline. Carregamos explicitamente para que o comportamento não
// dependa dessa ordem.
import "dotenv/config";

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * Resolução de modelo.
 *
 * Dois caminhos, escolhidos pelo ambiente:
 *
 *  - `OPENAI_API_KEY` presente → provider direto do AI SDK. É o caminho de
 *    desenvolvimento local: funciona sem `eve link` e sem projeto Vercel.
 *  - Sem a chave → devolve o ID como string, que o eve roteia pelo Vercel AI
 *    Gateway, autenticado por OIDC do projeto. É o caminho de produção.
 *
 * Os IDs de modelo NÃO são fixados no código de propósito. Nomes de modelo
 * mudam com frequência, e um default desatualizado falha em runtime com uma
 * mensagem obscura. Aqui a variável é obrigatória e o erro diz o que fazer.
 */

function requireModelId(variable: string): string {
  const value = process.env[variable];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `${variable} não está definida. Escolha o modelo em packages/agent/.env — ` +
        `ex.: ${variable}=gpt-5.6 (provider direto) ou ${variable}=openai/gpt-5.6 (AI Gateway).`,
    );
  }
  return value.trim();
}

function resolve(variable: string): LanguageModel {
  const modelId = requireModelId(variable);
  const apiKey = process.env.OPENAI_API_KEY;

  if (typeof apiKey === "string" && apiKey.length > 0) {
    // O AI Gateway usa IDs prefixados (`openai/gpt-5`); o provider direto usa
    // o slug puro (`gpt-5`). Aceitar as duas formas na configuração e
    // normalizar aqui evita um erro silencioso ao alternar entre os caminhos.
    const openai = createOpenAI({ apiKey });
    return openai(modelId.replace(/^openai\//, ""));
  }

  // O AI Gateway exige o prefixo do provedor. Aceitamos o slug curto no env
  // para que a mesma configuração Terra funcione localmente (provider direto)
  // e em produção (Gateway); ids já prefixados, inclusive de outro provedor,
  // permanecem intocados.
  return (modelId.includes("/") ? modelId : `openai/${modelId}`) as unknown as LanguageModel;
}

/** Coordenador e analista: conversa e agregação, modelo mais econômico. */
export function coordinatorModel(): LanguageModel {
  return resolve("CLARA_MODEL");
}

/**
 * Extrator: lê o texto de faturas reais e devolve transações estruturadas.
 * Pode receber um override explícito, mas por padrão usa o mesmo Terra para
 * que o custo não mude silenciosamente entre agentes.
 */
export function extractorModel(): LanguageModel {
  return resolve(process.env.CLARA_EXTRACTOR_MODEL ? "CLARA_EXTRACTOR_MODEL" : "CLARA_MODEL");
}

/**
 * Janela de contexto do modelo, em tokens.
 *
 * O eve precisa deste número para compilar a compactação de contexto, e só o
 * infere sozinho para IDs que o AI Gateway já conhece. Como os IDs aqui vêm de
 * configuração, informamos explicitamente.
 */
export function contextWindowTokens(): number {
  const raw = process.env.CLARA_MODEL_CONTEXT_WINDOW;
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 200_000;
}
