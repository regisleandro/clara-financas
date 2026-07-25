/**
 * Envia variáveis de ambiente para os projetos Vercel.
 *
 * São DOIS projetos, com conjuntos diferentes de variáveis: o control plane
 * (`apps/web`) e a instância do agente (`packages/agent`). Mandar o `.env` de
 * um para o projeto do outro é como o segredo do modelo acaba num bundle de
 * navegador.
 *
 * ## Por que allowlist, e não "manda tudo menos o que eu lembrei de excluir"
 *
 * A versão anterior lia o `.env` inteiro e excluía três chaves conhecidas.
 * `apps/web/.env` contém `DATABASE_ADMIN_URL` — o papel de MIGRAÇÃO, dono do
 * schema e superusuário — e ele passava direto. A aplicação em produção jamais
 * deve alcançar esse papel: é ele que pode desligar trigger, truncar tabela e
 * ignorar RLS. Toda a defesa em profundidade do projeto depende de o runtime
 * rodar como `clara_app`.
 *
 * Com denylist, a segurança depende de alguém lembrar de atualizar a lista toda
 * vez que uma variável nova entra no `.env`. Com allowlist, uma variável
 * esquecida deixa de funcionar — que é barulhento e barato — em vez de vazar,
 * que é silencioso e caro.
 *
 * Uso:
 *   pnpm env:preview              # control plane, ambiente preview
 *   pnpm env:production           # control plane, produção
 *   pnpm env:agent:preview        # agente, preview
 *   pnpm env:agent:production     # agente, produção
 *
 *   ... --plan                    # mostra o que iria, sem falar com a Vercel
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import dotenv from "dotenv";

type Plane = {
  label: string;
  envFile: string;
  /** Diretório do link Vercel. O agente é outro projeto, com outro `.vercel`. */
  cwd: string;
  allow: string[];
  /** Documenta o que é derivado em runtime, para o relatório não parecer falha. */
  derived: string[];
};

const PLANES: Record<"web" | "agent", Plane> = {
  web: {
    label: "control plane (apps/web)",
    envFile: "apps/web/.env",
    cwd: ".",
    allow: [
      // Papel de APLICAÇÃO. Nunca DATABASE_ADMIN_URL — ver o cabeçalho.
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      // Compartilhado com o agente: é o segredo que assina o token de acesso.
      // Os dois projetos precisam do MESMO valor.
      "AGENT_TOKEN_SECRET",
      // Público por construção: o navegador fala com o agente cross-origin.
      "NEXT_PUBLIC_AGENT_HOST",
      // Armazenamento dos PDFs. Sem ele o app grava em .data/, que num runtime
      // serverless é efêmero — em produção este token é obrigatório.
      "BLOB_READ_WRITE_TOKEN",
    ],
    derived: [
      "BETTER_AUTH_URL e APP_ORIGIN — derivados de VERCEL_URL em packages/env/src/server.ts",
    ],
  },
  agent: {
    label: "agente (packages/agent)",
    envFile: "packages/agent/.env",
    cwd: "packages/agent",
    allow: [
      "DATABASE_URL",
      "AGENT_TOKEN_SECRET",
      // Aqui APP_ORIGIN NÃO é derivado: o agente usa como origem do CORS e
      // como issuer esperado do token. Precisa ser a URL do control plane.
      "APP_ORIGIN",
      "CLARA_MODEL",
      "CLARA_EXTRACTOR_MODEL",
      "CLARA_MODEL_CONTEXT_WINDOW",
      // Ausente, o eve roteia pelo AI Gateway autenticado por OIDC do projeto,
      // que é o caminho preferido em produção.
      "OPENAI_API_KEY",
      // Modo silo (Etapa 4): fixa a instância num tenant. Vazio no modo pool.
      "TENANT_ID",
    ],
    derived: [],
  },
};

const VALID_ENVIRONMENTS = new Set(["development", "preview", "production"]);

/**
 * Guarda-chuva final. Se um dia alguém acrescentar uma destas a uma allowlist,
 * o script recusa antes de falar com a Vercel — errar aqui é caro demais para
 * depender de revisão de código.
 */
const NEVER_SYNC = new Set(["DATABASE_ADMIN_URL", "POSTGRES_URL_NON_POOLING"]);

const LOCAL_VALUE = /localhost|127\.0\.0\.1|0\.0\.0\.0|^file:/i;

function main() {
  const args = process.argv.slice(2);
  const planeKey = args.includes("--agent") ? "agent" : "web";
  const plane = PLANES[planeKey];
  const planOnly = args.includes("--plan");

  const environment = args.find((arg) => VALID_ENVIRONMENTS.has(arg)) ?? "preview";
  const passthrough = args.filter(
    (arg) => arg !== "--agent" && arg !== "--plan" && !VALID_ENVIRONMENTS.has(arg),
  );

  for (const key of plane.allow) {
    if (NEVER_SYNC.has(key)) {
      console.error(
        `A allowlist de ${plane.label} contém ${key}, que nunca deve sair daqui. Abortando.`,
      );
      process.exit(1);
    }
  }

  if (!existsSync(plane.envFile)) {
    console.error(`Arquivo de ambiente não encontrado: ${plane.envFile}`);
    process.exit(1);
  }

  const parsed = dotenv.parse(readFileSync(plane.envFile, "utf8"));
  const sending = new Map<string, string>();
  const missing: string[] = [];

  for (const key of plane.allow) {
    const value = parsed[key];
    if (value === undefined || value === "") missing.push(key);
    else sending.set(key, value);
  }

  // Tudo que está no arquivo e NÃO vai. Silêncio aqui é o que faz alguém
  // perder uma hora depurando uma variável que nunca chegou.
  const skipped = Object.keys(parsed).filter((key) => !sending.has(key));

  console.log(`\nDestino: ${plane.label} · ambiente ${environment}`);
  console.log(`Origem:  ${plane.envFile}\n`);

  console.log(`Enviando ${sending.size}:`);
  for (const key of sending.keys()) console.log(`  + ${key}`);

  if (skipped.length > 0) {
    console.log(`\nNÃO enviadas (fora da allowlist deste projeto):`);
    for (const key of skipped) {
      console.log(`  - ${key}${NEVER_SYNC.has(key) ? "   <- nunca sai daqui, por design" : ""}`);
    }
  }

  if (missing.length > 0) {
    console.log(`\nAusentes em ${plane.envFile} (opcionais ou a definir):`);
    for (const key of missing) console.log(`  ? ${key}`);
  }

  for (const derived of plane.derived) console.log(`\nDerivado em runtime: ${derived}`);

  const local = [...sending.entries()].filter(([, value]) => LOCAL_VALUE.test(value));
  if (local.length > 0 && environment !== "development") {
    console.warn(
      `\nAVISO: ${local.map(([key]) => key).join(", ")} aponta(m) para localhost. ` +
        `Em ${environment} isso não vai funcionar — corrija ${plane.envFile} e rode de novo.`,
    );
  }

  if (sending.size === 0) {
    console.log("\nNada a enviar.");
    return;
  }

  if (planOnly) {
    console.log("\n--plan: nada foi enviado.");
    return;
  }

  console.log("");
  for (const [key, value] of sending) {
    const result = spawnSync(
      "npx",
      [
        "vercel",
        "--cwd",
        plane.cwd,
        "env",
        "add",
        key,
        environment,
        "--force",
        "--yes",
        ...passthrough,
      ],
      {
        input: `${value}\n`,
        stdio: ["pipe", "inherit", "inherit"],
        encoding: "utf8",
        shell: process.platform === "win32",
      },
    );

    if (result.error !== undefined || result.status !== 0) {
      console.error(`Falhou ao enviar ${key}: ${result.error?.message ?? `status ${result.status}`}`);
      process.exit(result.status ?? 1);
    }
  }

  console.log("\nPronto. É preciso um novo deploy para as variáveis valerem.");
}

main();
