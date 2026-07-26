"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@clara-financas/db";
import { notifications } from "@clara-financas/db/schema/notification";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq, inArray, isNull } from "drizzle-orm";

import type { ActionResult } from "@/lib/review-types";
import { getTenantContext } from "@/lib/tenant";

/**
 * Marca os avisos exibidos como lidos.
 *
 * `notifications.readAt` existia no schema e NENHUM código o escrevia: o
 * primeiro aviso de vencimento acendia o badge de alertas para sempre, e a
 * seção "A Clara te avisou" reapresentava as mesmas mensagens a cada visita.
 * Um aviso que nunca se apaga ensina a pessoa a ignorar os avisos — o oposto
 * do que a proatividade promete.
 *
 * Marca por ids, não "tudo": lidos são exatamente os avisos que a página
 * RENDERIZOU. Um aviso criado entre o carregamento e o clique continua
 * não-lido, como deve.
 *
 * Nenhuma action confia no tenant vindo do cliente — a sessão decide.
 */
export async function markAlertsRead(ids: string[]): Promise<ActionResult> {
  const context = await getTenantContext();
  if (!context || context.status !== "ready") {
    return { ok: false, error: "Sessão expirada. Entre novamente." };
  }
  if (ids.length === 0) return { ok: true };

  try {
    await forTenant(
      context.tenantId,
      async (tx) => {
        await tx
          .update(notifications)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(notifications.tenantId, context.tenantId),
              inArray(notifications.id, ids.slice(0, 50)),
              // Só o não-lido: reler não reescreve o carimbo original.
              isNull(notifications.readAt),
            ),
          );
      },
      getDb(),
    );
  } catch {
    return { ok: false, error: "Não consegui marcar os avisos como lidos." };
  }

  // O badge do layout lê os não-lidos; a agenda relê a lista.
  revalidatePath("/agenda");
  revalidatePath("/inicio");
  return { ok: true };
}
