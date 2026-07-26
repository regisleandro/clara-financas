import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { batches } from "./ledger";

export const FINANCIAL_ACTION_OPERATIONS = [
  "resolve_invoice_difference",
  "register_invoice",
] as const;

export const FINANCIAL_ACTION_STATUS = ["prepared", "applied", "rejected"] as const;

/**
 * Proposta canônica de escrita financeira.
 *
 * O modelo pode pedir uma proposta, mas não inventa os números que serão
 * aplicados. A preparação captura revisão e estado esperado; a execução
 * revalida ambos depois que o Eve retoma o turno aprovado.
 */
export const financialActionProposals = pgTable(
  "financial_action_proposals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    batchId: text("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    operation: text("operation", { enum: FINANCIAL_ACTION_OPERATIONS }).notNull(),
    status: text("status", { enum: FINANCIAL_ACTION_STATUS }).notNull().default("prepared"),
    entityRevision: timestamp("entity_revision", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receipt: jsonb("receipt").$type<Record<string, unknown> | null>(),
    preparedBy: text("prepared_by").notNull(),
    appliedBy: text("applied_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (table) => [
    index("financial_actions_tenant_status_idx").on(table.tenantId, table.status),
    index("financial_actions_batch_idx").on(table.batchId),
    uniqueIndex("financial_actions_tenant_id_idx").on(table.tenantId, table.id),
  ],
);
