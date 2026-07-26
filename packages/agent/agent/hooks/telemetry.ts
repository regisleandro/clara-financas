import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { agentToolEvents, type AgentEventStatus } from "@clara-financas/db/schema/agent-event";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { defineHook } from "eve/hooks";

import { tenantIdOf } from "../lib/tenant";

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
 * O hook é o lugar certo porque é o único que vê TODAS as chamadas sem que
 * cada tool precise lembrar de se instrumentar — e uma instrumentação que
 * depende de lembrar é uma instrumentação com buracos exatamente nas tools
 * novas, que são as que mais falham.
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

/** O input de cada chamada, para casar com o resultado que chega depois. */
const pendingInputs = new Map<string, { toolName: string; summary: UnknownRecord | null }>();

export default defineHook({
  events: {
    "actions.requested": (event, ctx) => {
      const data = asRecord(asRecord(event)?.data);
      const actions = Array.isArray(data?.actions) ? data.actions : [];
      for (const item of actions) {
        const action = asRecord(item);
        const callId = asString(action?.callId);
        const toolName = asString(action?.toolName);
        if (callId === undefined || toolName === undefined) continue;
        pendingInputs.set(callId, { toolName, summary: summarize(action?.input) });
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

      if (status === "ok" && process.env.CLARA_TELEMETRY_ALL !== "1") return;

      await record({
        tenantId,
        sessionId: asString(ctx.session.id),
        callId,
        toolName,
        status,
        errorCode: asString(structured?.code),
        errorMessage: asString(structured?.message) ?? asString(error),
        inputSummary: pending?.summary ?? null,
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
        turnId: asString(data?.turnId),
        toolName: "turn",
        status: "falha",
        errorMessage: asString(data?.error) ?? asString(asRecord(data?.error)?.message),
      });
    },
  },
});
