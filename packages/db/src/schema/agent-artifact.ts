import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export type AgentArtifactKind = "analysis" | "categorization";

/**
 * Resultado temporário produzido por um subagente e consumido por referência.
 * Valores financeiros e ids permanecem aqui; o modelo pai recebe apenas `id`.
 */
export const agentArtifacts = pgTable(
  "agent_artifacts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    parentSessionId: text("parent_session_id").notNull(),
    kind: text("kind").$type<AgentArtifactKind>().notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agent_artifacts_tenant_session_idx").on(table.tenantId, table.parentSessionId),
    index("agent_artifacts_tenant_expires_idx").on(table.tenantId, table.expiresAt),
  ],
);
