import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Mensagens que a Clara inicia — o gatilho invertido da hipótese H6.
 *
 * Por que uma tabela e não um push: o canal HTTP do eve não empurra nada, e
 * Telegram/WhatsApp estão explicitamente fora do escopo da v1. Então "falar
 * primeiro" aqui significa **deixar a mensagem esperando**: o schedule acorda
 * sem ninguém pedir, decide que há algo a dizer, e a pessoa encontra o aviso
 * quando abre o app.
 *
 * A hipótese que isso testa continua sendo a mesma — o sistema iniciando a
 * conversa em vez de só responder. O que muda é o transporte, e trocar o
 * transporte depois não mexe nesta tabela.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),

    kind: text("kind", { enum: ["due_date", "monthly_digest"] }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),

    /** Compromisso que originou o aviso, quando houver. */
    commitmentId: text("commitment_id"),

    /** Quem disparou: `process:due_dates`, na convenção de ator do OKF §7. */
    createdBy: text("created_by").notNull(),

    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("notifications_tenant_created_idx").on(table.tenantId, table.createdAt)],
);
