import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Registry de tenants — vive no banco do CONTROL PLANE, nunca no banco de um
 * tenant. É o mapa tenant → banco → deployment, e por isso é o ativo mais
 * sensível do sistema: comprometê-lo compromete todos os tenants.
 *
 * Regras:
 *  - `dbCredentialRef` é uma REFERÊNCIA a um segredo, nunca a connection string.
 *  - Nenhum endpoint deve listar tenants; todo acesso é por id do dono.
 */

export const TENANT_STATUS = ["provisioning", "ready", "failed"] as const;
export type TenantStatus = (typeof TENANT_STATUS)[number];

export const tenants = pgTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),

    // provisioning → ready | failed. O layout de (app) barra qualquer estado
    // que não seja 'ready' e manda para /preparando.
    status: text("status", { enum: TENANT_STATUS }).notNull().default("provisioning"),

    // Preenchidos pelo provisionamento (Etapa 4). Nas Etapas 0–3 ficam nulos e
    // o app cai no host único de NEXT_PUBLIC_AGENT_HOST.
    agentHost: text("agent_host"),
    dbCredentialRef: text("db_credential_ref"),

    provisionedAt: timestamp("provisioned_at", { withTimezone: true }),

    /**
     * Versão da constituição já semeada neste espaço. Quando o bundle em disco
     * muda, este valor fica defasado e a semeadura roda de novo — é o que faz
     * uma edição no repositório chegar a quem já tem conta.
     */
    constitutionVersion: text("constitution_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("tenants_slug_idx").on(table.slug),
    // Um tenant por usuário na v1. É o que garante que um segundo login com a
    // mesma conta Google reuse o espaço em vez de provisionar outro.
    uniqueIndex("tenants_owner_user_id_idx").on(table.ownerUserId),
  ],
);

export const PROVISIONING_STATUS = ["queued", "running", "succeeded", "failed"] as const;
export type ProvisioningStatus = (typeof PROVISIONING_STATUS)[number];

export const provisioningJobs = pgTable(
  "provisioning_jobs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    status: text("status", { enum: PROVISIONING_STATUS }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    // Passos concluídos, para que um retry não refaça o que já deu certo
    // (criar banco, criar projeto, injetar env, deploy).
    completedSteps: jsonb("completed_steps").$type<string[]>().notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("provisioning_jobs_tenant_id_idx").on(table.tenantId)],
);

export const tenantRelations = relations(tenants, ({ one, many }) => ({
  owner: one(user, { fields: [tenants.ownerUserId], references: [user.id] }),
  jobs: many(provisioningJobs),
}));

export const provisioningJobRelations = relations(provisioningJobs, ({ one }) => ({
  tenant: one(tenants, { fields: [provisioningJobs.tenantId], references: [tenants.id] }),
}));
