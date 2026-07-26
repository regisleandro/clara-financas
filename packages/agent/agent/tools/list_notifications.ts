import { getDb } from "@clara-financas/db";
import { notifications } from "@clara-financas/db/schema/notification";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, desc, eq, isNull, type SQL } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireTenantCaller } from "../lib/tenant";

/**
 * "Que avisos você já me deu?" — a Clara passa a saber o que a Clara disse.
 *
 * As notificações eram escritas pela varredura de vencimentos e lidas só pela
 * tela da agenda: na conversa, a pergunta não tinha resposta, e a Clara podia
 * repetir na fala um aviso que a pessoa já tinha visto (ou jurar que avisou
 * algo que nunca saiu). O leitor fecha o ciclo da proatividade — o que foi
 * dito, quando, e se já foi visto.
 */
const LIMIT = 50;

export default defineTool({
  description:
    "Lists the proactive notifications Clara already sent (due-date warnings), newest first, each with whether the person has seen it. Use for 'que avisos você me deu', and to avoid repeating a warning already seen.",
  inputSchema: z.object({
    unreadOnly: z.boolean().optional().describe("Only what the person has not seen yet."),
    limit: z.number().int().min(1).max(LIMIT).optional(),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const limit = input.limit ?? 20;

    const filters: SQL[] = [eq(notifications.tenantId, tenantId)];
    if (input.unreadOnly === true) filters.push(isNull(notifications.readAt));

    const rows = await forTenant(
      tenantId,
      async (tx) =>
        tx
          .select()
          .from(notifications)
          .where(and(...filters))
          .orderBy(desc(notifications.createdAt))
          .limit(limit + 1),
      getDb(),
    );

    const truncated = rows.length > limit;
    const page = truncated ? rows.slice(0, limit) : rows;

    return {
      count: page.length,
      ...(truncated
        ? { truncated: true as const, note: `Mostrando os ${limit} avisos mais recentes; há mais.` }
        : {}),
      notifications: page.map((row) => ({
        kind: row.kind,
        title: row.title,
        body: row.body,
        commitmentId: row.commitmentId,
        sentAt: row.createdAt.toISOString(),
        // `null` = ainda não visto; a agenda marca ao exibir.
        seenAt: row.readAt === null ? null : row.readAt.toISOString(),
      })),
    };
  },
});
