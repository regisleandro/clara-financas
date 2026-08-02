import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const AGENT_TASK_STATUS = [
  "queued",
  "running",
  "complete",
  "needs_input",
  "blocked",
  "failed",
  "cancelled",
] as const;

export const AGENT_TASK_SPECIALISTS = [
  "documents",
  "reconciliation",
  "categorization",
  "analysis",
] as const;

/** Unidade persistente de delegação. */
export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sessionId: text("session_id").notNull(),
    goalId: text("goal_id").notNull(),
    specialist: text("specialist", { enum: AGENT_TASK_SPECIALISTS }).notNull(),
    objective: text("objective").notNull(),
    contextRefs: jsonb("context_refs").$type<string[]>().notNull().default([]),
    completionCriteria: jsonb("completion_criteria").$type<string[]>().notNull(),
    status: text("status", { enum: AGENT_TASK_STATUS }).notNull().default("queued"),
    resultRefs: jsonb("result_refs").$type<string[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    missingInputs: jsonb("missing_inputs").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_tasks_tenant_session_idx").on(table.tenantId, table.sessionId),
    index("agent_tasks_tenant_goal_idx").on(table.tenantId, table.goalId),
    index("agent_tasks_tenant_status_idx").on(table.tenantId, table.status),
  ],
);
