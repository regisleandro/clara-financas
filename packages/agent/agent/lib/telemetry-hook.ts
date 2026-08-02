import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { agentToolEvents, type AgentEventStatus } from "@clara-financas/db/schema/agent-event";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { defineHook } from "eve/hooks";

import { tenantIdOf } from "./tenant";

/**
 * O que aconteceu, guardado onde dá para consultar depois.
 *
 * Toda a observabilidade de produção era um `console.warn` no navegador da
 * pessoa. Quando a Clara falhava — e ela falhou, em produção, dizendo "não
 * consegui ajustar essa fatura agora" —, não havia como saber qual ferramenta
 * quebrou nem por quê: o trace vivia no `localStorage` do dispositivo e a
 * interface lia o erro como booleano, descartando a causa. Diagnosticar
 * dependia de a pessoa mandar um print.
 *
 * É uma FACTORY, não um hook: subagente declarado não herda os hooks do root —
 * cada um descobre só o próprio `hooks/`. Na primeira versão o hook morava
 * apenas no root, e as tools dos subagentes rodavam na sessão FILHA: o
 * extrator, componente mais caro e mais frágil do produto, era exatamente o
 * menos observado. Cada agente agora instala `telemetryHook()` no próprio
 * diretório, e o evento carrega o nome de quem executou.
 *
 * Falhar aqui nunca pode derrubar um turno: gravar log não é o trabalho, e um
 * erro de telemetria que interrompesse uma conferência de fatura seria a
 * observabilidade cobrando mais caro do que o problema que ela resolve.
 */

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const BEHAVIOR_CRITICAL_TOOLS = new Set([
  "aggregate_by_category",
  "compare_periods",
  "detect_recurrences",
  "query_ledger",
  "save_categorization",
  "save_extraction",
  "present_analysis",
  "analyze_series",
  "present_financial_artifact",
  "present_categorization",
  "recategorize_transactions",
]);

/**
 * O resumo do input — e o que ele DELIBERADAMENTE não carrega.
 *
 * Só as chaves enviadas, os identificadores e o tamanho das listas. Valor,
 * data, descrição, comerciante, corpo de conceito e senha de PDF ficam de
 * fora: para reproduzir uma falha basta saber que `edit_proposed_batch` foi
 * chamada com `batchId` e três edições; guardar o conteúdo transformaria o log
 * numa segunda cópia do razão, com as mesmas exigências de proteção e nenhuma
 * das defesas.
 */
function summarize(input: unknown): UnknownRecord | null {
  const record = asRecord(input);
  if (record === undefined) return null;

  const summary: UnknownRecord = { keys: Object.keys(record).sort() };
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) summary[`${key}Count`] = value.length;
    // Identificadores são seguros e são o que amarra o evento ao dado: sem
    // eles, "falhou ao abrir uma fatura" não diz QUAL fatura.
    else if (/(^|[a-z])Id$/.test(key) && typeof value === "string") summary[key] = value;
    else if (typeof value === "boolean") summary[key] = value;
  }
  return summary;
}

async function record(entry: {
  tenantId: string;
  sessionId?: string;
  turnId?: string;
  callId?: string;
  toolName: string;
  status: AgentEventStatus;
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
  inputSummary?: UnknownRecord | null;
}): Promise<void> {
  try {
    await forTenant(
      entry.tenantId,
      async (tx) => {
        await tx.insert(agentToolEvents).values({
          id: `evt_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
          tenantId: entry.tenantId,
          sessionId: entry.sessionId ?? null,
          turnId: entry.turnId ?? null,
          callId: entry.callId ?? null,
          toolName: entry.toolName,
          status: entry.status,
          errorCode: entry.errorCode ?? null,
          // Truncado: uma mensagem de erro longa é ruído, e um stack inteiro
          // no banco é como se perde a leitura de uma tabela de log.
          errorMessage: entry.errorMessage?.slice(0, 500) ?? null,
          durationMs: entry.durationMs ?? null,
          inputSummary: entry.inputSummary ?? null,
        });
      },
      getDb(),
    );
  } catch (error) {
    // Último recurso: o log do processo. Nunca propaga.
    console.error("[clara] telemetria falhou", {
      tool: entry.toolName,
      status: entry.status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * O input de cada chamada, para casar com o resultado que chega depois.
 *
 * Com teto e prazo, porque a versão sem os dois VAZAVA: turno cancelado,
 * crash, ou `action.result` sem `callId` deixavam a entrada presa para
 * sempre num Map de módulo. O teto protege a memória; o prazo aceita que em
 * serverless o `actions.requested` e o `action.result` podem cair em
 * instâncias diferentes — nesse caso o evento sai sem `inputSummary` e sem
 * `durationMs`, que é degradação, não erro.
 *
 * Nota sobre `durationMs`: mede do pedido ao resultado NO MESMO processo.
 * Numa tool com gate, isso inclui o tempo que a pessoa levou para decidir —
 * leitura correta: é o tempo que o passo custou, não o tempo de CPU.
 */
const MAX_PENDING = 1000;
const STALE_MS = 6 * 60 * 60 * 1000;

const pendingInputs = new Map<
  string,
  { toolName: string; summary: UnknownRecord | null; requestedAt: number }
>();

function prunePending(now: number): void {
  for (const [key, value] of pendingInputs) {
    // Ordem de inserção do Map: os mais antigos vêm primeiro.
    if (now - value.requestedAt < STALE_MS && pendingInputs.size < MAX_PENDING) break;
    pendingInputs.delete(key);
  }
}

/**
 * Recibo entregue e ainda não apresentado, por sessão.
 *
 * Mesmo teto e prazo do `pendingInputs` logo acima, e pela mesma razão: um
 * `Map` de módulo sem limite vaza em turno cancelado. Aqui o dado é minúsculo
 * (uma string por sessão) e some no fim do turno em qualquer caminho.
 */
const pendingReceipts = new Map<string, { nextAction: string; at: number }>();

export function telemetryHook() {
  return defineHook({
    events: {
      "actions.requested": (event, ctx) => {
        const now = Date.now();
        prunePending(now);
        const data = asRecord(asRecord(event)?.data);
        const actions = Array.isArray(data?.actions) ? data.actions : [];
        for (const item of actions) {
          const action = asRecord(item);
          const callId = asString(action?.callId);
          const toolName = asString(action?.toolName);
          if (callId === undefined || toolName === undefined) continue;
          pendingInputs.set(callId, {
            toolName,
            summary: summarize(action?.input),
            requestedAt: now,
          });
        }
        void ctx;
      },

      "action.result": async (event, ctx) => {
        const tenantId = tenantIdOf(ctx.session.auth.current);
        if (tenantId === undefined) return;

        const data = asRecord(asRecord(event)?.data);
        const result = asRecord(data?.result);
        const callId = asString(result?.callId);
        const pending = callId === undefined ? undefined : pendingInputs.get(callId);
        const toolName = asString(result?.toolName) ?? pending?.toolName;
        if (toolName === undefined) return;
        if (callId !== undefined) pendingInputs.delete(callId);

        const output = asRecord(result?.output);
        const error = output?.error;
        const structured = asRecord(error);
        const crashed = asString(data?.status) === "failed";

        /*
         * O recibo que ficou sem apresentação.
         *
         * `nextAction` sempre foi "control flow obrigatório" escrito em prosa, e
         * a única verificação existente era uma regex conferindo que a FRASE
         * estava no prompt. Quando o modelo recebia o recibo e encerrava o turno
         * sem chamar `present_*`, o painel não aparecia, a resposta em texto
         * dizia "veja ao lado", e o log não tinha nada: nenhuma tool falhou.
         *
         * Impor de verdade não é possível neste framework — hooks são
         * observe-only e `defineDynamic` não assina `action.result`, então não
         * há como exigir uma chamada específica. O que dá para fazer, e é o que
         * faltava, é parar de ser invisível: a omissão vira evento com nome.
         */
        const sessionId = asString(ctx.session.id);
        if (sessionId !== undefined && error === undefined) {
          const nextAction = asString(output?.nextAction);
          if (nextAction !== undefined) {
            pendingReceipts.set(sessionId, { nextAction, at: Date.now() });
          } else if (toolName.startsWith("present_")) {
            pendingReceipts.delete(sessionId);
          }
        }

        // Três estados, e a distinção é o ponto: um pedido recusado APONTANDO a
        // saída (categoria que não existe, lote já decidido) é o sistema
        // funcionando. Contá-lo como falha faria o alerta disparar no
        // comportamento correto e virar ruído que ninguém olha.
        const status: AgentEventStatus =
          crashed || (error !== undefined && structured?.retryable !== true)
            ? "falha"
            : error !== undefined
              ? "recuperavel"
              : "ok";

        if (
          status === "ok" &&
          process.env.CLARA_TELEMETRY_ALL !== "1" &&
          !BEHAVIOR_CRITICAL_TOOLS.has(toolName)
        ) {
          return;
        }

        // O agente que executou entra no resumo: as tools de subagente rodam
        // na sessão filha, com o hook do próprio subagente, e sem isto os
        // eventos do extrator e do analista eram indistinguíveis dos do root.
        const agentName = asString(asRecord(asRecord(ctx as unknown)?.agent)?.name);
        const summary = pending?.summary ?? null;
        const inputSummary =
          agentName === undefined ? summary : { ...(summary ?? {}), agent: agentName };

        await record({
          tenantId,
          sessionId: asString(ctx.session.id),
          turnId: asString(asRecord(asRecord(ctx.session as unknown)?.turn)?.id),
          callId,
          toolName,
          status,
          errorCode: asString(structured?.code),
          errorMessage: asString(structured?.message) ?? asString(error),
          durationMs: pending === undefined ? undefined : Date.now() - pending.requestedAt,
          inputSummary,
        });
      },

      "turn.completed": async (_event, ctx) => {
        const tenantId = tenantIdOf(ctx.session.auth.current);
        const sessionId = asString(ctx.session.id);
        if (tenantId === undefined || sessionId === undefined) return;

        const pending = pendingReceipts.get(sessionId);
        if (pending === undefined) return;
        pendingReceipts.delete(sessionId);

        // O turno terminou com um recibo na mão e sem a apresentação que ele
        // pedia. Recuperável, não falha: a resposta existe, o painel é que não
        // chegou — e agora dá para contar quantas vezes isso acontece.
        await record({
          tenantId,
          sessionId,
          toolName: "turn",
          status: "recuperavel",
          errorCode: "recibo_nao_apresentado",
          errorMessage: `O turno terminou sem chamar ${pending.nextAction}; o painel não chegou à tela.`,
        });
      },

      "turn.failed": async (event, ctx) => {
        const tenantId = tenantIdOf(ctx.session.auth.current);
        if (tenantId === undefined) return;

        const data = asRecord(asRecord(event)?.data);
        // Um turno pode morrer sem nenhuma tool ter falhado — schema recusado na
        // saída de um subagente, contexto estourado, transporte. Era o caso mais
        // difícil de diagnosticar justamente por não deixar rastro nenhum.
        await record({
          tenantId,
          sessionId: asString(ctx.session.id),
          turnId:
            asString(data?.turnId) ??
            asString(asRecord(asRecord(ctx.session as unknown)?.turn)?.id),
          toolName: "turn",
          status: "falha",
          errorMessage: asString(data?.error) ?? asString(asRecord(data?.error)?.message),
        });
      },
    },
  });
}
