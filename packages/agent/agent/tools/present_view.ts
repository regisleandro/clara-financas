import { ViewSchema, viewTransactionIds } from "@clara-financas/views";
import { defineTool } from "eve/tools";

import { requireTenantCaller } from "../lib/tenant";

/**
 * A Clara escolhe como a resposta aparece.
 *
 * Antes, o frontend inferia o painel a partir do que as ferramentas do
 * analista tinham devolvido. Duas falhas vieram daí, ambas observadas em uso:
 * painel montado quando a resposta era uma pergunta, e nenhum painel quando o
 * formato do retorno mudava. Inferência não tem como acertar — ela não sabe o
 * que está sendo respondido.
 *
 * Aqui a forma é decisão de quem tem o contexto. A Clara acabou de ler os
 * números e sabe se aquilo é uma comparação, uma composição ou um alerta.
 *
 * **Não passa pelo gate**: não escreve nada, não muda razão nem conceito. Pedir
 * aprovação para desenhar na tela seria ruído — o gate existe para o que é
 * irreversível, e gastar a atenção da pessoa com o que é reversível a treina a
 * aprovar sem ler.
 */
export default defineTool({
  description:
    "Renders the answer as a rich panel beside the conversation. Call this WHENEVER the answer involves numbers, a comparison, a list, or a verification — the chat text becomes the short summary and the detail goes to the panel. All text inside the payload must be Brazilian Portuguese, because it is rendered to the person verbatim. Do not use for purely conversational replies.",
  inputSchema: ViewSchema,

  async execute(input, ctx) {
    // Guard mesmo sem escrita: uma tool sem tenant no contexto é sinal de
    // caminho interno mal ligado, e falhar fechado aqui é mais barato que
    // descobrir isso numa tool que escreve.
    requireTenantCaller(ctx);

    const ids = viewTransactionIds(input);

    // O retorno é para o MODELO, não para a tela — a tela lê o input da
    // chamada direto do stream. Devolver o painel inteiro aqui só faria o
    // modelo reescrever no texto o que já está desenhado ao lado.
    return {
      presented: input.kind,
      title: input.title,
      rowCount: input.rows?.length ?? 0,
      provenanceCount: ids.length,
      note:
        "Panel shown with validated provenance. Reply in the chat in 2-3 sentences, in Brazilian Portuguese, without repeating the panel's numbers.",
    };
  },
});
