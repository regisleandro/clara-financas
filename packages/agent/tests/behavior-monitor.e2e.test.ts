import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { FinancialArtifactSchema, ViewSchema } from "@clara-financas/views";
import { SignJWT } from "jose";

/**
 * Monitor sintético do comportamento do MODELO contra um agente implantado.
 * A suíte determinística prova contas, RLS e gates em cada PR; esta prova que
 * a coordenadora ainda delega e apresenta os contratos corretamente quando o
 * modelo real está no loop. Só roda com BEHAVIOR_MONITOR=1.
 */

const enabled = process.env.BEHAVIOR_MONITOR === "1";
const runs = Math.max(1, Number.parseInt(process.env.BEHAVIOR_EVAL_RUNS ?? "1", 10) || 1);
const base = process.env.AGENT_BASE_URL?.replace(/\/$/, "") ?? "";
const scenarios = new Set(
  (process.env.BEHAVIOR_SCENARIOS ?? "analysis,series,categorizer,category_gate,extractor")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

let token = "";

type ToolResult = { toolName: string; output: Record<string, unknown> };
type TurnTrace = {
  tools: string[];
  results: ToolResult[];
  failure?: unknown;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} é obrigatório no monitor live`);
  return value;
}

async function runTurn(message: string): Promise<TurnTrace> {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
  const created = await fetch(`${base}/eve/v1/session`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(20_000),
  });
  assert.ok(created.ok, `criação da sessão falhou: ${created.status}`);
  const sessionId = created.headers.get("x-eve-session-id");
  assert.ok(sessionId, "agente não devolveu x-eve-session-id");

  const response = await fetch(`${base}/eve/v1/session/${sessionId}/stream`, {
    headers,
    signal: AbortSignal.timeout(180_000),
  });
  assert.ok(response.ok && response.body, `stream falhou: ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const pending = new Map<string, string>();
  const trace: TurnTrace = { tools: [], results: [] };
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim() === "") continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        const data = record(event.data);
        if (event.type === "actions.requested") {
          const actions = Array.isArray(data?.actions) ? data.actions : [];
          for (const rawAction of actions) {
            const action = record(rawAction);
            const callId = typeof action?.callId === "string" ? action.callId : undefined;
            const toolName = typeof action?.toolName === "string" ? action.toolName : undefined;
            if (callId !== undefined && toolName !== undefined) pending.set(callId, toolName);
            if (toolName !== undefined) trace.tools.push(toolName);
          }
        }
        if (event.type === "subagent.called") {
          const name =
            typeof data?.name === "string"
              ? data.name
              : typeof data?.toolName === "string"
                ? data.toolName
                : undefined;
          if (name !== undefined && !trace.tools.includes(name)) trace.tools.push(name);
          const callId = typeof data?.callId === "string" ? data.callId : undefined;
          if (name !== undefined && callId !== undefined) pending.set(callId, name);
        }
        if (event.type === "subagent.completed") {
          const callId = typeof data?.callId === "string" ? data.callId : undefined;
          const toolName = callId === undefined ? undefined : pending.get(callId);
          if (toolName !== undefined) {
            trace.results.push({ toolName, output: record(data?.output) ?? {} });
          }
        }
        if (event.type === "action.result") {
          const result = record(data?.result);
          const callId = typeof result?.callId === "string" ? result.callId : undefined;
          const toolName =
            typeof result?.toolName === "string"
              ? result.toolName
              : callId === undefined
                ? undefined
                : pending.get(callId);
          if (toolName !== undefined) {
            if (!trace.tools.includes(toolName)) trace.tools.push(toolName);
            trace.results.push({ toolName, output: record(result?.output) ?? {} });
          }
        }
        if (event.type === "turn.failed") trace.failure = data?.error ?? data;
        if (event.type === "session.waiting" || event.type === "turn.failed") return trace;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return trace;
}

async function consistently(
  label: string,
  message: string,
  expectation: (trace: TurnTrace) => void,
) {
  const failures: string[] = [];
  for (let attempt = 1; attempt <= runs; attempt += 1) {
    try {
      const trace = await runTurn(message);
      expectation(trace);
    } catch (error) {
      failures.push(`#${attempt}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  assert.equal(failures.length, 0, `${label} falhou em ${failures.length}/${runs}: ${failures.join(" | ")}`);
}

before(async () => {
  if (!enabled) return;
  const secret = required("AGENT_TOKEN_SECRET");
  const tenantId = required("PROBE_TENANT");
  const userId = process.env.PROBE_USER ?? "usr_behavior_monitor";
  token = await new SignJWT({ tenantId, userId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(required("APP_ORIGIN"))
    .setAudience("clara-agent")
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(new TextEncoder().encode(secret));

  const health = await fetch(`${required("AGENT_BASE_URL").replace(/\/$/, "")}/eve/v1/health`, {
    signal: AbortSignal.timeout(10_000),
  });
  assert.ok(health.ok, `health do agente falhou: ${health.status}`);
});

describe("monitor live dos comportamentos ponta a ponta", () => {
  it("analista preserva mês vazio, usa artefato e não recalcula no pai", async (t) => {
    if (!enabled || !scenarios.has("analysis")) return t.skip("cenário live não habilitado");
    await consistently(
      "análise vazia",
      "Quanto gastei em janeiro de 2099? Preserve exatamente esse mês, mesmo sem lançamentos.",
      (trace) => {
        assert.equal(trace.failure, undefined);
        assert.ok(trace.tools.includes("analyst"), `sem delegação: ${trace.tools.join(", ")}`);
        assert.ok(trace.tools.includes("present_analysis"), `sem apresentação: ${trace.tools.join(", ")}`);
        assert.ok(!trace.tools.includes("read_batch"));
        assert.ok(!trace.tools.includes("present_view"));
        const output = trace.results.find((result) => result.toolName === "present_analysis")?.output;
        assert.deepEqual(output?.requestedScope, { kind: "calendar_month", month: "2099-01" });
        assert.deepEqual(output?.actualScope, output?.requestedScope);
        const parsed = ViewSchema.safeParse(output?.view);
        assert.ok(parsed.success, "present_analysis não devolveu View válida");
        assert.match(JSON.stringify(parsed.data), /Sem lançamentos/i);
      },
    );
  });

  it("categorizador apenas propõe e apresenta", async (t) => {
    if (!enabled || !scenarios.has("categorizer")) return t.skip("cenário live não habilitado");
    await consistently(
      "triagem de categorias",
      "Organize o que está sem categoria. Apenas mostre as propostas; não aplique nenhuma mudança.",
      (trace) => {
        assert.equal(trace.failure, undefined);
        assert.ok(trace.tools.includes("categorizer"), `sem delegação: ${trace.tools.join(", ")}`);
        assert.ok(
          trace.tools.includes("present_categorization"),
          `sem apresentação: ${trace.tools.join(", ")} · resultados=${JSON.stringify(trace.results)}`,
        );
        assert.ok(
          !trace.tools.includes("recategorize_transactions"),
          `aplicou sem pedido: ${trace.tools.join(", ")}`,
        );
      },
    );
  });

  it("comparação de três períodos não reduz a pergunta a um par", async (t) => {
    if (!enabled || !scenarios.has("series")) return t.skip("cenário live não habilitado");
    await consistently(
      "série de faturas",
      "Compare as três últimas faturas do Nubank, explique a evolução e mostre o que mais mudou.",
      (trace) => {
        assert.equal(trace.failure, undefined);
        assert.ok(trace.tools.includes("analyst"), `sem delegação: ${trace.tools.join(", ")}`);
        assert.ok(
          trace.tools.includes("present_financial_artifact"),
          `sem artefato rico: ${trace.tools.join(", ")}`,
        );
        const output = trace.results.find(
          (result) => result.toolName === "present_financial_artifact",
        )?.output;
        const parsed = FinancialArtifactSchema.safeParse(output?.artifact);
        assert.ok(parsed.success, "artefato de série inválido");
        assert.equal(parsed.data.kind, "timeline");
        assert.equal(parsed.data.scope.kind, "periods");
        assert.equal(parsed.data.scope.periods.length, 3);
        const series = parsed.data.blocks.find((block) => block.type === "series");
        assert.ok(series, "artefato não contém a série dos períodos");
        assert.equal(series.points.length, 3, "a série foi reduzida a menos de três pontos");
      },
    );
  });

  it("uma única correção de categoria abre o mesmo gate", async (t) => {
    if (!enabled || !scenarios.has("category_gate")) return t.skip("cenário live não habilitado");
    const transactionId = required("PROBE_TRANSACTION_ID");
    await consistently(
      "gate de categoria",
      `Corrija somente o lançamento ${transactionId} para a categoria groceries (Mercado).`,
      (trace) => {
        assert.equal(trace.failure, undefined);
        assert.ok(trace.tools.includes("recategorize_transactions"));
        assert.ok(!trace.tools.includes("set_transaction_category"));
      },
    );
  });

  it("extrator passa a leitura por recibo e nunca retranscreve o lote", async (t) => {
    if (!enabled || !scenarios.has("extractor")) return t.skip("cenário live não habilitado");
    const documentId = required("PROBE_DOCUMENT_ID");
    await consistently(
      "extração por referência",
      `Leia o documento ${documentId}, extraia todas as linhas e apenas prepare o rascunho. Não registre a fatura.`,
      (trace) => {
        assert.equal(trace.failure, undefined);
        assert.ok(trace.tools.includes("extractor"), `sem delegação: ${trace.tools.join(", ")}`);
        assert.ok(trace.tools.includes("propose_batch_from_extraction"));
        assert.ok(!trace.tools.includes("propose_batch"));
        assert.ok(!trace.tools.includes("commit_batch"));
      },
    );
  });
});
