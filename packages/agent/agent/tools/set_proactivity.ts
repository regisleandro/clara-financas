import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { conceptRevisions, concepts } from "@clara-financas/db/schema/knowledge";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { PROACTIVITY_CONCEPT_ID } from "../lib/proactivity";
import { optionalText } from "../lib/schema";
import { requireTenantCaller, tenantIdOf } from "../lib/tenant";

/**
 * O interruptor geral dos avisos automáticos.
 *
 * `deactivate_commitment` desliga UM lembrete; isto desliga a varredura
 * inteira para esta pessoa — "não quero que a Clara me avise de nada sem eu
 * pedir". É a metade consentimento do princípio de proatividade, que até aqui
 * só tinha a metade relevância.
 *
 * Passa pelo gate nas duas direções: desligar silencia avisos que a pessoa
 * aprovou um a um, e religar autoriza a Clara a falar primeiro de novo — as
 * duas são decisões dela, não inferências.
 *
 * O estado é um conceito (`preferences/proactivity`, bundle learnings) com
 * trilha de revisões: quem mudou, quando e por quê fica registrado, como todo
 * aprendizado.
 */
const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

export default defineTool({
  description:
    "Requests approval to turn Clara's proactive warnings ON or OFF as a whole (the daily due-date sweep). Individual reminders have deactivate_commitment; this is the master switch. Use when the person says they do not want automatic warnings at all — or wants them back.",
  inputSchema: z.object({
    enabled: z.boolean().describe("false silences every automatic warning; true turns them back on."),
    reason: optionalText().describe("Why, in Brazilian Portuguese — goes into the revision trail."),
  }),

  approval: (ctx) => {
    const current = tenantIdOf(ctx.session.auth.current);
    if (current === undefined || current !== tenantIdOf(ctx.session.auth.initiator)) {
      return { type: "denied", reason: "A sessão não está fixada a um único usuário." };
    }
    return "user-approval";
  },

  async execute(input, ctx) {
    const { tenantId, userId } = requireTenantCaller(ctx);

    return forTenant(
      tenantId,
      async (tx) => {
        const frontmatter = {
          type: "Preference",
          title: "Proatividade",
          enabled: input.enabled,
          verified: [{ by: `human:${userId}`, at: new Date().toISOString() }],
        };
        const body = input.enabled
          ? "Avisos automáticos ligados: a varredura diária de vencimentos pode avisar."
          : "Avisos automáticos desligados: a varredura diária de vencimentos não avisa nada.";

        const [existing] = await tx
          .select({ id: concepts.id })
          .from(concepts)
          .where(
            and(
              eq(concepts.tenantId, tenantId),
              eq(concepts.bundle, "learnings"),
              eq(concepts.conceptId, PROACTIVITY_CONCEPT_ID),
            ),
          )
          .limit(1);

        const rowId = existing?.id ?? id("cpt");
        if (existing !== undefined) {
          await tx
            .update(concepts)
            .set({ frontmatter, body })
            .where(eq(concepts.id, rowId));
        } else {
          await tx.insert(concepts).values({
            id: rowId,
            tenantId,
            bundle: "learnings",
            conceptId: PROACTIVITY_CONCEPT_ID,
            type: "Preference",
            frontmatter,
            body,
          });
        }

        // A trilha conta quem mudou o interruptor, quando e por quê — a mesma
        // disciplina de todo aprendizado.
        await tx.insert(conceptRevisions).values({
          id: id("rev"),
          tenantId,
          conceptRowId: rowId,
          author: `human:${userId}`,
          reason:
            input.reason ?? (input.enabled ? "avisos religados" : "avisos desligados"),
          frontmatter,
          body,
        });

        return {
          proactivity: input.enabled ? ("on" as const) : ("off" as const),
          note: input.enabled
            ? "A varredura diária volta a avisar sobre os compromissos ativos."
            : "Nenhum aviso automático sai mais. Os compromissos continuam guardados; os vencimentos seguem visíveis na agenda.",
        };
      },
      getDb(),
    );
  },
});
