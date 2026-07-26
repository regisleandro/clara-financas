import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * O que aconteceu em cada chamada de ferramenta.
 *
 * A observabilidade de produção era, literalmente, um `console.warn` no
 * navegador da pessoa. Quando a Clara falhava, não havia como saber qual tool
 * quebrou, com que argumento e com que erro: o trace vivia no `localStorage`
 * do dispositivo, com teto de 500 KB, e a interface lia o erro como booleano e
 * jogava a causa fora. Diagnosticar dependia de a pessoa mandar um print.
 *
 * Esta tabela é o mínimo que muda isso — e o máximo que pode ser guardado sem
 * virar um segundo banco de dados financeiro.
 *
 * **O que NÃO entra aqui, por construção:** valor, data, descrição de
 * lançamento, nome de comerciante, senha de PDF, corpo de conceito. O input é
 * reduzido a um resumo (`inputSummary`) com as CHAVES enviadas, os
 * identificadores (`batchId`, `documentId`) e o tamanho das listas. Isso basta
 * para reproduzir uma falha e não basta para reconstruir a vida financeira de
 * ninguém a partir do log.
 */
export const AGENT_EVENT_STATUS = ["ok", "recuperavel", "falha"] as const;
export type AgentEventStatus = (typeof AGENT_EVENT_STATUS)[number];

export const agentToolEvents = pgTable(
  "agent_tool_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sessionId: text("session_id"),
    turnId: text("turn_id"),
    /** O `callId` amarra o evento à chamada exata que o trace mostrou. */
    callId: text("call_id"),
    toolName: text("tool_name").notNull(),
    status: text("status", { enum: AGENT_EVENT_STATUS }).notNull(),
    /** O `code` do erro estruturado — é por ele que se conta e se alerta. */
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    inputSummary: jsonb("input_summary").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agent_tool_events_tenant_created_idx").on(table.tenantId, table.createdAt),
    // A pergunta que se faz num incidente é "o que anda falhando?", e ela
    // precisa de índice: sem isto, contar erros por tool varre a tabela.
    index("agent_tool_events_tenant_status_idx").on(table.tenantId, table.status),
  ],
);
