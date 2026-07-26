import type { View } from "@clara-financas/views";

/**
 * Follow-ups derivados do painel do turno corrente.
 *
 * Os do servidor são derivados do RAZÃO (estado durável); estes são derivados
 * da RESPOSTA que acabou de aparecer na tela — "Ver os lançamentos de
 * Restaurantes" só faz sentido enquanto o breakdown está aberto. Os dois se
 * somam, com o contexto imediato primeiro, e o total é capado para a fileira
 * de pílulas não virar um menu.
 */
const MAX_FOLLOWUPS = 4;

export function deriveFollowups(
  view: View | null,
  serverFollowups: readonly string[],
): string[] {
  const contextual: string[] = [];

  if (view !== null) {
    switch (view.kind) {
      case "breakdown": {
        const top = view.rows[0];
        if (top !== undefined) contextual.push(`Ver os lançamentos de ${top.label}`);
        break;
      }
      case "comparison":
        contextual.push("Detalhar o que mais subiu");
        break;
      case "recurrences":
        contextual.push("Qual dessas vale cancelar?");
        break;
      case "checksum":
        if (view.result === "mismatch") contextual.push("Onde está a diferença?");
        break;
      case "metric":
        contextual.push("Como isso se compara ao período anterior?");
        break;
      case "commitments":
        // Um lembrete já está agendado — oferecer "me lembre disso" seria
        // oferecer o que a pessoa acabou de ver pronto. O que ela ainda não
        // sabe é o peso da soma no mês.
        contextual.push("Quanto isso pesa neste mês?");
        break;
      case "proposal":
        // A proposta existe para ser decidida; o follow-up é a decisão, não
        // mais uma pergunta sobre ela.
        contextual.push("Aplicar essas mudanças");
        break;
      case "transactions":
        break;
    }
  }

  const merged: string[] = [...contextual];
  for (const followup of serverFollowups) {
    // Sem duplicar: o servidor pode sugerir o mesmo caminho que o painel.
    if (!merged.includes(followup)) merged.push(followup);
  }
  return merged.slice(0, MAX_FOLLOWUPS);
}
