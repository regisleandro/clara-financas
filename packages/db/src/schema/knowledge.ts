import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Conhecimento semântico, no formato OKF v0.2.
 *
 * O que substitui o git: `concepts` guarda o estado corrente e
 * `concept_revisions` é APPEND-ONLY — cada aprovação insere uma revisão com
 * autor e momento. Isso dá histórico e `revert` (escrever de volta um corpo
 * anterior), que são as propriedades que a hipótese H3 pede. A portabilidade
 * vem de `export_bundle`, que remonta o diretório OKF de verdade.
 *
 * Dois bundles, distinção que é decisão NOSSA e não conceito OKF (o formato
 * não tem modelo de acesso):
 *  - `constitution`: contrato do domínio, escrito pelo autor, só leitura no app
 *  - `learnings`: o que a Clara aprendeu, escrito sempre via gate de aprovação
 */
export const BUNDLES = ["constitution", "learnings"] as const;
export type Bundle = (typeof BUNDLES)[number];

/** Frontmatter OKF: `type` é o único campo sempre obrigatório (SPEC §11). */
export type ConceptFrontmatter = {
  type: string;
  title?: string;
  description?: string;
  tags?: string[];
  status?: "draft" | "stable" | "deprecated";
  generated?: { by: string; at: string };
  verified?: Array<{ by: string; at: string }>;
  [key: string]: unknown;
};

export const concepts = pgTable(
  "concepts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bundle: text("bundle", { enum: BUNDLES }).notNull(),
    // ID OKF do conceito: o caminho dentro do bundle, sem `.md`.
    // Ex.: "categories/groceries", "merchants/padaria-central".
    conceptId: text("concept_id").notNull(),
    // `type` do frontmatter, promovido a coluna por ser o único obrigatório
    // e o que mais se filtra. É livre, não enum (SPEC §4.1).
    type: text("type").notNull(),
    frontmatter: jsonb("frontmatter").$type<ConceptFrontmatter>().notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("concepts_tenant_bundle_concept_idx").on(
      table.tenantId,
      table.bundle,
      table.conceptId,
    ),
    index("concepts_tenant_type_idx").on(table.tenantId, table.type),
  ],
);

/**
 * Trilha de auditoria. APPEND-ONLY: nada aqui é atualizado ou removido.
 * `revert` é escrever uma nova revisão com um corpo antigo, nunca apagar.
 */
export const conceptRevisions = pgTable(
  "concept_revisions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    conceptRowId: text("concept_row_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    // Convenção de ator do OKF §7: "human:<id>" para pessoas,
    // "<produtor>/<versão>" para agentes.
    author: text("author").notNull(),
    // Por que esta revisão existe (ex.: "regra aprovada no cartão").
    reason: text("reason"),
    frontmatter: jsonb("frontmatter").$type<ConceptFrontmatter>().notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("concept_revisions_tenant_concept_idx").on(table.tenantId, table.conceptRowId),
    index("concept_revisions_created_at_idx").on(table.createdAt),
  ],
);

export const conceptRelations = relations(concepts, ({ many }) => ({
  revisions: many(conceptRevisions),
}));

export const conceptRevisionRelations = relations(conceptRevisions, ({ one }) => ({
  concept: one(concepts, {
    fields: [conceptRevisions.conceptRowId],
    references: [concepts.id],
  }),
}));
