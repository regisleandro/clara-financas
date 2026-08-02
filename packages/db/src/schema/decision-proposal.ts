import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const DECISION_PROPOSAL_STATUS = [
  "pending",
  "approved",
  "denied",
  "expired",
  "applied",
  "failed",
] as const;

/** Envelope comum para toda decisão durável exibida na bandeja. */
export const decisionProposals = pgTable(
  "decision_proposals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sessionId: text("session_id").notNull(),
    goalId: text("goal_id"),
    taskId: text("task_id"),
    operation: text("operation").notNull(),
    targetRef: text("target_ref").notNull(),
    title: text("title").notNull(),
    consequence: text("consequence").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    entityRevision: timestamp("entity_revision", { withTimezone: true }).notNull(),
    status: text("status", { enum: DECISION_PROPOSAL_STATUS }).notNull().default("pending"),
    preparedBy: text("prepared_by").notNull(),
    decidedBy: text("decided_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    receipt: jsonb("receipt").$type<Record<string, unknown> | null>(),
  },
  (table) => [
    index("decision_proposals_tenant_status_idx").on(table.tenantId, table.status),
    index("decision_proposals_tenant_session_idx").on(table.tenantId, table.sessionId),
    index("decision_proposals_tenant_goal_idx").on(table.tenantId, table.goalId),
  ],
);
