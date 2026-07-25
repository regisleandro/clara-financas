import "server-only";

import { getDb } from "@clara-financas/db";
import { commitments } from "@clara-financas/db/schema/commitment";
import { notifications } from "@clara-financas/db/schema/notification";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, asc, desc, eq, isNull } from "drizzle-orm";

/** Hoje em São Paulo. O cron roda em UTC; a data de quem usa não é a dele. */
function todayInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function daysUntil(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

export async function loadAgenda(tenantId: string) {
  const db = getDb();
  const today = todayInSaoPaulo();

  return forTenant(
    tenantId,
    async (tx) => {
      const [commitmentRows, notificationRows] = await Promise.all([
        tx
          .select()
          .from(commitments)
          .where(and(eq(commitments.tenantId, tenantId), eq(commitments.active, "yes")))
          .orderBy(asc(commitments.dueDate)),
        tx
          .select()
          .from(notifications)
          .where(and(eq(notifications.tenantId, tenantId), isNull(notifications.readAt)))
          .orderBy(desc(notifications.createdAt))
          .limit(10),
      ]);

      return {
        today,
        commitments: commitmentRows.map((row) => ({
          id: row.id,
          title: row.title,
          counterparty: row.counterparty,
          dueDate: row.dueDate,
          daysUntil: daysUntil(today, row.dueDate),
          expectedAmount: row.expectedAmount,
        })),
        notifications: notificationRows.map((row) => ({
          id: row.id,
          title: row.title,
          body: row.body,
          createdBy: row.createdBy,
          createdAt: row.createdAt,
        })),
      };
    },
    db,
  );
}

/** Há avisos não lidos? Alimenta o ponto azul na barra de navegação. */
export async function hasUnreadAlerts(tenantId: string): Promise<boolean> {
  const rows = await forTenant(
    tenantId,
    async (tx) =>
      tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.tenantId, tenantId), isNull(notifications.readAt)))
        .limit(1),
    getDb(),
  );
  return rows.length > 0;
}
