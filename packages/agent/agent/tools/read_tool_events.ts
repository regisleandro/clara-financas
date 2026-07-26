import { agentToolEvents } from "@clara-financas/db/schema/agent-event";
import { getDb } from "@clara-financas/db";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { optionalText } from "../lib/schema";
import { requireTenantCaller } from "../lib/tenant";

/**
 * A telemetria ganha leitor — "o que deu errado nas últimas conversas?".
 *
 * `agent_tool_events` era escrita pelo hook e lida por ninguém: diagnosticar
 * dependia de `psql`. Com o leitor, a própria Clara responde "por que aquilo
 * falhou ontem?" citando a ferramenta, o código do erro e a duração — sem
 * expor nada além do que o resumo já protege por construção (chaves, ids e
 * contagens; nunca valor, descrição ou senha).
 *
 * Leitura pura, sem gate. A tabela é append-only por grant de banco.
 */
const LIMIT = 50;

export default defineTool({
  description:
    "Reads the tool execution log: which tool ran, status (ok/recuperavel/falha), error code, duration. Use for 'o que deu errado', 'por que falhou ontem'. Carries no financial values by construction — only tool names, ids and counts.",
  inputSchema: z.object({
    status: z
      .enum(["ok", "recuperavel", "falha"])
      .optional()
      .describe("Only events with this status. `falha` is the usual question."),
    toolName: optionalText().describe("Only events of one tool."),
    limit: z.number().int().min(1).max(LIMIT).optional(),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    const limit = input.limit ?? 20;

    const filters: SQL[] = [eq(agentToolEvents.tenantId, tenantId)];
    if (input.status !== undefined) filters.push(eq(agentToolEvents.status, input.status));
    if (input.toolName !== undefined) filters.push(eq(agentToolEvents.toolName, input.toolName));

    const rows = await forTenant(
      tenantId,
      async (tx) =>
        tx
          .select()
          .from(agentToolEvents)
          .where(and(...filters))
          .orderBy(desc(agentToolEvents.createdAt))
          .limit(limit + 1),
      getDb(),
    );

    const truncated = rows.length > limit;
    const page = truncated ? rows.slice(0, limit) : rows;

    return {
      count: page.length,
      ...(truncated
        ? {
            truncated: true as const,
            note: `Mostrando os ${limit} eventos mais recentes; há mais. Filtre por status ou toolName.`,
          }
        : {}),
      // Sucessos só são gravados com CLARA_TELEMETRY_ALL=1 — sem isso, a
      // ausência de eventos "ok" não significa que nada rodou.
      events: page.map((row) => ({
        toolName: row.toolName,
        status: row.status,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
        durationMs: row.durationMs,
        inputSummary: row.inputSummary,
        at: row.createdAt.toISOString(),
      })),
    };
  },
});
