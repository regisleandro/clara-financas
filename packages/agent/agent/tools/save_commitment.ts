import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { commitments } from "@clara-financas/db/schema/commitment";
import { forTenant } from "@clara-financas/db/tenant-scope";
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
    "Registra um vencimento ou lembrete para avisar a pessoa antes da data. Exige aprovação. Use quando uma fatura revelar um vencimento, ou quando a pessoa pedir para ser lembrada de algo.",
  inputSchema: z.object({
    kind: z.enum(["invoice_due", "subscription_charge", "custom"]),
    title: z.string().min(1).describe("Como o compromisso aparece na agenda."),
    counterparty: optionalText().describe("Emissor ou comerciante, ex.: 'Nubank'."),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Próximo vencimento, YYYY-MM-DD."),
    recurrenceDayOfMonth: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe("Dia do mês em que recorre. Omita para compromisso único."),
    expectedAmount: z
      .number()
      .int()
      .optional()
      .describe("Valor esperado EM CENTAVOS, quando conhecido."),
    remindDaysBefore: z.number().int().min(0).max(30).optional().describe("Padrão: 3."),
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
        // mesmo vencimento — o índice único cuida disso, e aqui atualizamos
        // em vez de falhar.
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
          .onConflictDoUpdate({
            target: [commitments.tenantId, commitments.kind, commitments.counterparty],
            set: {
              title: input.title,
              dueDate: input.dueDate,
              recurrenceDayOfMonth: input.recurrenceDayOfMonth ?? null,
              expectedAmount: input.expectedAmount ?? null,
              remindDaysBefore: input.remindDaysBefore ?? 3,
              active: "yes",
            },
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
