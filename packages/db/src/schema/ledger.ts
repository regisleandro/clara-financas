import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * O razão.
 *
 * Disciplina que sustenta a hipótese H5 (números reproduzíveis): uma vez
 * confirmada, transação NÃO é editada nem apagada. Correção vira uma linha de
 * ajuste apontando para a original. Um trigger impõe isso no banco — depender
 * de disciplina de código seria depender de todo mundo lembrar, para sempre.
 *
 * Enquanto o lote está `proposed` ele é rascunho, não razão: editar ali é
 * livre, e é o que permite o botão "Corrigir" do cartão de conferência
 * conviver com um gate de aprovação binário.
 */

export const DOCUMENT_KINDS = ["credit_card_invoice", "bank_statement", "invoice_nfe"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
    /** Chave no Blob, sob prefixo do tenant. O PDF nunca entra no banco. */
    blobKey: text("blob_key").notNull(),
    filename: text("filename").notNull(),
    issuer: text("issuer"),
    /** SHA-256 do arquivo: detecta reenvio do mesmo documento. */
    contentHash: text("content_hash").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("documents_tenant_idx").on(table.tenantId),
    uniqueIndex("documents_tenant_hash_idx").on(table.tenantId, table.contentHash),
  ],
);

export const BATCH_STATUS = ["proposed", "confirmed", "rejected"] as const;
export type BatchStatus = (typeof BATCH_STATUS)[number];

export const CHECKSUM_RESULTS = ["match", "mismatch", "no_declared_total"] as const;

export const batches = pgTable(
  "batches",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    status: text("status", { enum: BATCH_STATUS }).notNull().default("proposed"),

    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    dueDate: text("due_date"),

    /** Centavos. `bigint` porque centavos crescem rápido em inteiro. */
    declaredTotal: bigint("declared_total", { mode: "number" }),
    /**
     * Subtotais do resumo da fatura ("IOF de compras internacionais"), em
     * centavos. Persistidos porque a reconferência após uma correção precisa
     * deles para continuar dizendo ONDE está a divergência.
     */
    declaredSubtotals: jsonb("declared_subtotals").$type<{
      fees: number | null;
      purchases: number | null;
    } | null>(),
    extractedTotal: bigint("extracted_total", { mode: "number" }),
    checksumResult: text("checksum_result", { enum: CHECKSUM_RESULTS }),
    checksumReport: jsonb("checksum_report"),

    /** Quem aprovou e quando — a decisão vira dado. */
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("batches_tenant_status_idx").on(table.tenantId, table.status),
    index("batches_document_idx").on(table.documentId),
  ],
);

export const TRANSACTION_STATUS = ["proposed", "confirmed", "adjustment"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUS)[number];

export const CONFIDENCE = ["alta", "media", "baixa"] as const;
export const ENTRY_KINDS = ["purchase", "payment", "refund", "fee", "adjustment"] as const;

export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    batchId: text("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),

    status: text("status", { enum: TRANSACTION_STATUS }).notNull().default("proposed"),

    date: text("date").notNull(),
    originalDescription: text("original_description").notNull(),
    merchant: text("merchant"),
    /** Centavos, SINALIZADO: despesa > 0, crédito < 0. */
    amount: bigint("amount", { mode: "number" }).notNull(),
    kind: text("kind", { enum: ENTRY_KINDS }).notNull().default("purchase"),
    installmentCurrent: integer("installment_current"),
    installmentTotal: integer("installment_total"),
    category: text("category"),
    extractionConfidence: text("extraction_confidence", { enum: CONFIDENCE }).notNull(),

    /** Proveniência: sem isso, "de onde veio esse valor" não tem resposta. */
    sourceDocumentId: text("source_document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    page: integer("page"),

    /** Preenchido só em linhas de ajuste: a transação que está sendo corrigida. */
    adjustsTransactionId: text("adjusts_transaction_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("transactions_tenant_status_idx").on(table.tenantId, table.status),
    index("transactions_batch_idx").on(table.batchId),
    index("transactions_tenant_date_idx").on(table.tenantId, table.date),
    index("transactions_adjusts_idx").on(table.adjustsTransactionId),
  ],
);

export const documentRelations = relations(documents, ({ many }) => ({
  batches: many(batches),
  transactions: many(transactions),
}));

export const batchRelations = relations(batches, ({ one, many }) => ({
  document: one(documents, { fields: [batches.documentId], references: [documents.id] }),
  transactions: many(transactions),
}));

export const transactionRelations = relations(transactions, ({ one }) => ({
  batch: one(batches, { fields: [transactions.batchId], references: [batches.id] }),
  sourceDocument: one(documents, {
    fields: [transactions.sourceDocumentId],
    references: [documents.id],
  }),
}));
