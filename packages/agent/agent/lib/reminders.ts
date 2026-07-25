import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { commitments } from "@clara-financas/db/schema/commitment";
import { notifications } from "@clara-financas/db/schema/notification";
import { tenants } from "@clara-financas/db/schema/tenant";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { formatCents } from "@clara-financas/ledger";
import { and, eq } from "drizzle-orm";

import { daysUntil, nextOccurrence, todayInSaoPaulo } from "./dates";

/**
 * O varredor de vencimentos.
 *
 * Vive em `lib/` e não dentro do schedule de propósito: assim pode ser testado
 * e disparado manualmente sem depender do cron, que em `eve dev` nunca roda.
 *
 * **Modo pool:** uma instância atende todos os tenants, então a varredura
 * itera tenants EXPLICITAMENTE e abre um escopo por vez. Nunca há uma consulta
 * "global" — isso furaria o isolamento justamente no caminho automatizado, que
 * é o menos observado. No modo silo (Etapa 4) esta iteração desaparece: cada
 * instância só enxerga o próprio tenant.
 */

export type ReminderResult = {
  today: string;
  tenantsScanned: number;
  created: Array<{ tenantId: string; title: string; dueDate: string; daysUntil: number }>;
};

export async function sweepDueDates(now: Date = new Date()): Promise<ReminderResult> {
  const db = getDb();
  const today = todayInSaoPaulo(now);

  // O registry de tenants fica no control plane e não tem RLS — é lido fora de
  // qualquer escopo de tenant, o que é correto: é o mapa, não o conteúdo.
  const allTenants = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.status, "ready"));

  const created: ReminderResult["created"] = [];

  for (const tenant of allTenants) {
    await forTenant(
      tenant.id,
      async (tx) => {
        const rows = await tx
          .select()
          .from(commitments)
          .where(and(eq(commitments.tenantId, tenant.id), eq(commitments.active, "yes")));

        for (const row of rows) {
          const remaining = daysUntil(today, row.dueDate);

          // Fora da janela de aviso ainda; nada a fazer.
          if (remaining > row.remindDaysBefore) continue;

          // Já avisamos deste vencimento. A entrega do cron é at-least-once,
          // e sem esta marca a pessoa receberia o mesmo aviso a cada execução.
          if (row.lastNotifiedFor === row.dueDate) {
            // Vencimento passou e é recorrente: avança para o próximo ciclo.
            if (remaining < 0 && row.recurrenceDayOfMonth !== null) {
              await tx
                .update(commitments)
                .set({ dueDate: nextOccurrence(today, row.recurrenceDayOfMonth) })
                .where(eq(commitments.id, row.id));
            }
            continue;
          }

          const valor =
            row.expectedAmount === null ? "" : ` de ${formatCents(row.expectedAmount)}`;
          const quando =
            remaining < 0
              ? `venceu há ${Math.abs(remaining)} ${Math.abs(remaining) === 1 ? "dia" : "dias"}`
              : remaining === 0
                ? "vence hoje"
                : `vence em ${remaining} ${remaining === 1 ? "dia" : "dias"}`;

          await tx.insert(notifications).values({
            id: `ntf_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
            tenantId: tenant.id,
            kind: "due_date",
            title: `${row.title} ${quando}.`,
            body: `${row.title}${valor} ${quando} (${row.dueDate}). Quer revisar antes de pagar?`,
            commitmentId: row.id,
            createdBy: "process:due_dates",
          });

          await tx
            .update(commitments)
            .set({ lastNotifiedFor: row.dueDate })
            .where(eq(commitments.id, row.id));

          created.push({
            tenantId: tenant.id,
            title: row.title,
            dueDate: row.dueDate,
            daysUntil: remaining,
          });
        }
      },
      db,
    );
  }

  return { today, tenantsScanned: allTenants.length, created };
}
