import {
  checkView,
  formatViewIssues,
  ViewPayloadSchema,
  viewTransactionIds,
} from "@clara-financas/views";
import { defineTool } from "eve/tools";

import { toolError } from "../lib/errors";
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
 *
 * O `inputSchema` valida a FORMA; a proveniência é conferida aqui no corpo. A
 * diferença não é estética. Enquanto a regra vivia no schema, a recusa acontecia
 * antes desta função: não gerava resultado de tool, não entrava na telemetria e
 * chegava ao modelo como erro de validação sem saída indicada. O efeito visível
 * era a pessoa pedir uma lista e não receber nada — e nenhum registro no banco
 * dizendo por quê. Agora é um erro recuperável, com `hint`, que
 * `read_tool_events` encontra depois.
 */
export default defineTool({
  description:
    "Renders the answer as a rich panel beside the conversation. Call this WHENEVER the answer involves numbers, a comparison, a list, or a verification — the chat text becomes the short summary and the detail goes to the panel. All text inside the payload must be Brazilian Portuguese, because it is rendered to the person verbatim. Do not use for purely conversational replies.",
  inputSchema: ViewPayloadSchema,

  async execute(input, ctx) {
    // Guard mesmo sem escrita: uma tool sem tenant no contexto é sinal de
    // caminho interno mal ligado, e falhar fechado aqui é mais barato que
    // descobrir isso numa tool que escreve.
    requireTenantCaller(ctx);

    const issues = checkView(input);
    if (issues.length > 0) {
      return toolError(
        "painel_sem_proveniencia",
        `O painel não foi desenhado: ${formatViewIssues(issues).join("; ")}`,
        {
          hint: "Cada linha com valor precisa dos transactionIds que a compõem, OU de um `basis` dizendo o que sustenta o número quando ele não é soma de lançamentos: `document` (total declarado pelo documento, diferença de uma fatura), `projection` (valor anualizado ou estimado), `schedule` (compromisso futuro). Os ids vêm das tools — read_batch para uma fatura, query_ledger para um recorte, as agregações do analista por linha. Corrija e chame de novo; não responda sem o painel.",
          retryable: true,
        },
      );
    }

    const ids = viewTransactionIds(input);

    // O retorno é para o MODELO, não para a tela — a tela lê o input da
    // chamada direto do stream. Devolver o painel inteiro aqui só faria o
    // modelo reescrever no texto o que já está desenhado ao lado.
    // Quantas linhas afirmam dinheiro sem sair do razão. Vai no retorno porque
    // é o número que denuncia o abuso do `basis`: um painel de composição com
    // metade das linhas "declaradas" não é uma composição, e isto aparece na
    // telemetria antes de virar reclamação.
    const declared = (input.rows ?? []).filter(
      (row) => row.basis !== undefined && row.basis !== "ledger",
    ).length;

    return {
      presented: input.kind,
      title: input.title,
      rowCount: input.rows?.length ?? 0,
      provenanceCount: ids.length,
      ...(declared > 0 ? { rowsWithDeclaredBasis: declared } : {}),
      note:
        "Panel shown with validated provenance. Reply in the chat in 2-3 sentences, in Brazilian Portuguese, without repeating the panel's numbers.",
    };
  },
});
