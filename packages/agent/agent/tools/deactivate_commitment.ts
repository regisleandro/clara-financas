import { getDb } from "@clara-financas/db";
import { commitments } from "@clara-financas/db/schema/commitment";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { notFound } from "../lib/errors";
import { requireTenantCaller, tenantIdOf } from "../lib/tenant";

/**
 * A porta de saída do lembrete.
 *
 * `commitments.active` existia com os dois valores no schema e só recebia
 * "yes": criado um compromisso, a varredura diária voltava a avisar todo ciclo,
 * para sempre, sem nenhum caminho — nem pela conversa, nem pela tela — para
 * dizer "chega". O consentimento do princípio de proatividade era de mão
 * única.
 *
 * Passa pelo gate pelo mesmo motivo de `save_commitment`: falar primeiro (e
 * parar de falar) é uma autorização da pessoa, não uma inferência da Clara.
 * A varredura (`lib/reminders.ts`) filtra `active = 'yes'`, então gravar
 * "no" basta para calar o aviso — sem apagar o histórico do compromisso.
 *
 * Atenção ao caminho de volta: o upsert de `save_commitment` REATIVA um
 * compromisso do mesmo (kind, counterparty). É aceitável porque também passa
 * pelo cartão — mas a Clara não deve recriar por conta própria um lembrete que
 * a pessoa acabou de desligar.
 */
export default defineTool({
  description:
    "Requests approval to deactivate a reminder: the daily sweep stops warning about it, history is kept. Use when the person asks to stop being reminded. Ids come from list_commitments. Note save_commitment on the same (kind, counterparty) would reactivate it — do not recreate a reminder the person just turned off.",
  inputSchema: z.object({
    commitmentId: z.string().min(1).describe("Id from list_commitments."),
    title: z
      .string()
      .min(1)
      .describe(
        "The commitment's title, verbatim — it is what the approval card shows, so the person knows exactly which reminder is being turned off.",
      ),
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
        const [commitment] = await tx
          .select({ id: commitments.id, title: commitments.title, active: commitments.active })
          .from(commitments)
          .where(and(eq(commitments.id, input.commitmentId), eq(commitments.tenantId, tenantId)))
          .limit(1);

        if (commitment === undefined) {
          return notFound(
            "compromisso_nao_encontrado",
            `Nenhum compromisso com o id ${input.commitmentId}.`,
            { hint: "Chame list_commitments para pegar o id certo." },
          );
        }

        // Idempotência: aprovar duas vezes (replay do passo durável) não pode
        // virar erro — desligado continua desligado.
        if (commitment.active === "no") {
          return {
            commitmentId: commitment.id,
            title: commitment.title,
            active: "no" as const,
            alreadyInactive: true as const,
          };
        }

        await tx
          .update(commitments)
          .set({ active: "no" })
          .where(and(eq(commitments.id, commitment.id), eq(commitments.tenantId, tenantId)));

        return {
          commitmentId: commitment.id,
          title: commitment.title,
          active: "no" as const,
          note: "A Clara para de avisar sobre este vencimento. O histórico fica; reativar é salvar o compromisso de novo, com aprovação.",
        };
      },
      getDb(),
    );
  },
});
