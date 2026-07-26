import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { commitments } from "@clara-financas/db/schema/commitment";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq, sql } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { optionalText } from "../lib/schema";
import { requireTenantCaller, tenantIdOf } from "../lib/tenant";

/**
 * Registra um compromisso — vencimento de fatura, cobrança recorrente ou
 * lembrete criado pela pessoa.
 *
 * Passa pelo gate porque é o que autoriza a Clara a **falar primeiro**. Um
 * lembrete que a pessoa não pediu é notificação indesejada, e a diferença
 * entre proatividade e incômodo é exatamente esse consentimento.
 */
export default defineTool({
  description:
    "Requests approval to record a due date or reminder. Call when date, recurrence and warning lead time are ready to show; the call opens the decision card and executes only after approval. Saving over an existing (kind, counterparty) REACTIVATES a deactivated reminder — never do that for one the person just turned off with deactivate_commitment.",
  inputSchema: z.object({
    kind: z.enum(["invoice_due", "subscription_charge", "custom"]),
    title: z.string().min(1).describe("How the commitment appears in the schedule. Write it in Brazilian Portuguese."),
    counterparty: optionalText().describe("Issuer or merchant, e.g. 'Nubank'."),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Next due date, YYYY-MM-DD."),
    recurrenceDayOfMonth: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe("Day of month it recurs on. Omit for a one-off commitment."),
    expectedAmount: z
      .number()
      .int()
      .optional()
      .describe("Expected amount IN CENTS, when known."),
    remindDaysBefore: z.number().int().min(0).max(30).optional().describe("Defaults to 3."),
  }),

  approval: (ctx) => {
    const current = tenantIdOf(ctx.session.auth.current);
    if (current === undefined || current !== tenantIdOf(ctx.session.auth.initiator)) {
      return { type: "denied", reason: "A sessão não está fixada a um único usuário." };
    }
    return "user-approval";
  },

  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);

    return forTenant(
      tenantId,
      async (tx) => {
        const id = `cmt_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

        // Reprocessar a mesma fatura não pode criar um segundo lembrete do
        // mesmo vencimento. O upsert é manual porque o índice único é parcial
        // e por expressão (`coalesce(counterparty,'')`, só para kinds que vêm
        // de documento) — um ON CONFLICT por colunas nunca casaria com ele, e
        // era exatamente assim que counterparty nulo duplicava lembretes.
        // `custom` fica de fora de propósito: lembretes livres da pessoa são
        // linhas independentes.
        if (input.kind !== "custom") {
          const [existing] = await tx
            .select({ id: commitments.id })
            .from(commitments)
            .where(
              and(
                eq(commitments.tenantId, tenantId),
                eq(commitments.kind, input.kind),
                sql`coalesce(${commitments.counterparty}, '') = coalesce(${input.counterparty ?? null}, '')`,
              ),
            )
            .limit(1);

          if (existing !== undefined) {
            const [row] = await tx
              .update(commitments)
              .set({
                title: input.title,
                dueDate: input.dueDate,
                recurrenceDayOfMonth: input.recurrenceDayOfMonth ?? null,
                expectedAmount: input.expectedAmount ?? null,
                remindDaysBefore: input.remindDaysBefore ?? 3,
                active: "yes",
              })
              .where(eq(commitments.id, existing.id))
              .returning({ id: commitments.id, dueDate: commitments.dueDate });

            return {
              commitmentId: row?.id ?? existing.id,
              dueDate: row?.dueDate ?? input.dueDate,
              remindDaysBefore: input.remindDaysBefore ?? 3,
            };
          }
        }

        const [row] = await tx
          .insert(commitments)
          .values({
            id,
            tenantId,
            kind: input.kind,
            title: input.title,
            counterparty: input.counterparty ?? null,
            dueDate: input.dueDate,
            recurrenceDayOfMonth: input.recurrenceDayOfMonth ?? null,
            expectedAmount: input.expectedAmount ?? null,
            remindDaysBefore: input.remindDaysBefore ?? 3,
          })
          .returning({ id: commitments.id, dueDate: commitments.dueDate });

        return {
          commitmentId: row?.id ?? id,
          dueDate: row?.dueDate ?? input.dueDate,
          remindDaysBefore: input.remindDaysBefore ?? 3,
        };
      },
      getDb(),
    );
  },
});
