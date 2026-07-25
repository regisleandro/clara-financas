import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { transactions } from "./ledger";

/**
 * Trilha de recategorização.
 *
 * Existe porque categoria e valor são coisas de naturezas diferentes:
 *
 *  - **Valor, data, descrição e origem são FATO.** Vieram do documento. Depois
 *    de confirmados não mudam; correção vira linha de ajuste, e a aritmética
 *    do razão preserva a história.
 *  - **Categoria e comerciante são LEITURA.** São interpretação de quem
 *    organiza, e interpretação legitimamente muda — é exatamente disso que
 *    trata a hipótese H4, o sistema aprendendo com as correções da pessoa.
 *
 * Tratar as duas com o mesmo mecanismo seria erro: um par de linhas de ajuste
 * `−X` e `+X` só para reetiquetar encheria o razão de ruído de soma zero e
 * tornaria os totais confusos, sem ganho de auditoria nenhum.
 *
 * Então a mudança de leitura é permitida, mas nunca silenciosa: cada uma
 * registra aqui quem mudou, quando, de quê para quê e por quê. Append-only,
 * como toda trilha.
 */
export const transactionReclassifications = pgTable(
  "transaction_reclassifications",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),

    field: text("field", { enum: ["category", "merchant"] }).notNull(),
    previousValue: text("previous_value"),
    newValue: text("new_value"),

    /** Convenção de ator do OKF §7: `human:<id>` ou `<agente>/<versão>`. */
    author: text("author").notNull(),
    reason: text("reason"),
    /** Conceito que motivou a mudança, quando veio de uma regra aprendida. */
    byConceptId: text("by_concept_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("reclassifications_tenant_idx").on(table.tenantId),
    index("reclassifications_transaction_idx").on(table.transactionId),
  ],
);

export const reclassificationRelations = relations(
  transactionReclassifications,
  ({ one }) => ({
    transaction: one(transactions, {
      fields: [transactionReclassifications.transactionId],
      references: [transactions.id],
    }),
  }),
);
