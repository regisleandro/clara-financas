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
    "Mostra a resposta como painel rico ao lado da conversa. Chame SEMPRE que a resposta tiver números, comparação, lista ou conferência — o texto do chat vira o resumo curto, e o detalhe vai para o painel. Não use para respostas puramente conversacionais.",
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
        ids.length === 0
          ? "Painel exibido sem proveniência: a pessoa não conseguirá abrir as transações de origem. Inclua transactionIds nas linhas quando o número vier do razão."
          : "Painel exibido. Responda no chat em 2 a 3 frases, sem repetir os números do painel.",
    };
  },
});
