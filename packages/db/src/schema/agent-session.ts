import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Posse de sessão do eve.
 *
 * Existe porque o eve NÃO faz isso: a documentação é explícita que
 * "route auth does not enforce session ownership", e o endpoint de stream
 * devolve o `continuationToken`. Sem esta tabela, um usuário autenticado que
 * descubra o `sessionId` de outro lê a conversa inteira e ainda consegue
 * postar follow-ups — inclusive `inputResponses`, ou seja, aprovar escritas
 * em nome da vítima.
 *
 * O spike da Etapa 0 confirmou que o `AuthFn` enxerga o `:sessionId` da URL em
 * todas as rotas protegidas (inclusive `cancel`), então a ACL é imposta lá.
 *
 * No modo silo esta tabela fica redundante — a topologia já garante a posse —
 * mas permanece: é a rede caso um tenant volte a ser pooled.
 */
export const agentSessions = pgTable(
  "agent_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("agent_sessions_tenant_idx").on(table.tenantId)],
);
