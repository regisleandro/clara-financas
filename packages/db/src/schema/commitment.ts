import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Compromissos financeiros: vencimentos e lembretes.
 *
 * Por que uma tabela, e não só um conceito OKF: o conceito guarda o
 * significado ("a fatura do Nubank vence dia 7"), mas o disparo precisa de
 * estado operacional — próxima data, quando já foi avisado, lease para não
 * avisar duas vezes. Misturar as duas coisas faria o conhecimento semântico
 * carregar mecânica de fila.
 *
 * O eve NÃO tem agendamento dinâmico: schedules são arquivos estáticos
 * descobertos no build. Então um lembrete criado pela pessoa não vira um
 * schedule novo — vira uma linha aqui, que um único schedule despachante lê.
 * Entrega é at-least-once, daí `lastNotifiedFor`.
 */

export const COMMITMENT_KINDS = ["invoice_due", "subscription_charge", "custom"] as const;
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];

export const commitments = pgTable(
  "commitments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),

    kind: text("kind", { enum: COMMITMENT_KINDS }).notNull(),
    title: text("title").notNull(),
    /** Emissor ou comerciante, quando o compromisso vem de um documento. */
    counterparty: text("counterparty"),

    /** Próximo vencimento, YYYY-MM-DD. */
    dueDate: text("due_date").notNull(),
    /** Dia do mês em que recorre. Nulo para compromisso único. */
    recurrenceDayOfMonth: integer("recurrence_day_of_month"),

    /** Valor esperado em centavos, quando conhecido. */
    expectedAmount: integer("expected_amount"),

    /** Quantos dias antes avisar. */
    remindDaysBefore: integer("remind_days_before").notNull().default(3),

    /**
     * Última data de vencimento para a qual já avisamos.
     *
     * É o que torna o despacho idempotente: a entrega do cron é at-least-once,
     * e sem esta marca a pessoa receberia o mesmo aviso a cada execução.
     */
    lastNotifiedFor: text("last_notified_for"),

    /** Conceito OKF que descreve este compromisso, quando houver. */
    conceptId: text("concept_id"),

    active: text("active", { enum: ["yes", "no"] }).notNull().default("yes"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("commitments_tenant_due_idx").on(table.tenantId, table.dueDate),
    // Um compromisso por contraparte e tipo: reprocessar a mesma fatura não
    // deve criar um segundo lembrete do mesmo vencimento.
    //
    // O `coalesce` existe porque, num índice único do Postgres, NULLs são
    // DISTINTOS entre si: com `counterparty` nulo o conflito nunca disparava e
    // cada chamada criava uma linha nova — lembretes duplicados, avisados N
    // vezes pelo cron. (Expressão em vez de `NULLS NOT DISTINCT` para não
    // exigir Postgres 15.) O índice é parcial: `custom` fica de fora porque
    // lembretes livres da pessoa não devem colidir entre si.
    uniqueIndex("commitments_tenant_kind_counterparty_idx")
      .on(table.tenantId, table.kind, sql`coalesce(${table.counterparty}, '')`)
      .where(sql`${table.kind} <> 'custom'`),
  ],
);
