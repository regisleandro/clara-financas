import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const CONVERSATION_GOAL_STATUS = [
  "active",
  "waiting",
  "completed",
  "needs_input",
  "blocked",
  "cancelled",
] as const;

/** Intenção de produto, separada do transcript do Eve. */
export const conversationGoals = pgTable(
  "conversation_goals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sessionId: text("session_id").notNull(),
    intent: text("intent").notNull(),
    entities: jsonb("entities").$type<unknown[]>().notNull().default([]),
    scope: jsonb("scope").$type<Record<string, unknown> | null>(),
    completionCriteria: jsonb("completion_criteria").$type<string[]>().notNull(),
    status: text("status", { enum: CONVERSATION_GOAL_STATUS }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("conversation_goals_tenant_session_idx").on(table.tenantId, table.sessionId),
    index("conversation_goals_tenant_status_idx").on(table.tenantId, table.status),
  ],
);
