import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const CONVERSATION_ARTIFACT_KIND = [
  "analysis",
  "comparison",
  "breakdown",
  "reconciliation",
  "timeline",
  "proposal",
] as const;

/** Artefato visível ao usuário; diferente da staging temporária entre agentes. */
export const conversationArtifacts = pgTable(
  "conversation_artifacts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sessionId: text("session_id").notNull(),
    goalId: text("goal_id"),
    kind: text("kind", { enum: CONVERSATION_ARTIFACT_KIND }).notNull(),
    version: integer("version").notNull().default(1),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("conversation_artifacts_tenant_session_idx").on(table.tenantId, table.sessionId),
    index("conversation_artifacts_tenant_goal_idx").on(table.tenantId, table.goalId),
  ],
);
