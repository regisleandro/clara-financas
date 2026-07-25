import { defineAgent } from "eve";

import { extractorModel } from "../../lib/models";

/**
 * O extrator.
 *
 * `description` é obrigatório: o pai lê exatamente este texto para decidir
 * quando delegar, então ele descreve o gatilho, não a implementação.
 *
 * Isolamento: um subagente declarado NÃO herda nada do root. Ele só alcança as
 * tools autoradas no próprio diretório — e ali não existe nenhuma tool de
 * escrita nem de leitura do razão. A tabela de "Acessos" da spec vira garantia
 * do compilador, não disciplina de quem escreve o código.
 */
export default defineAgent({
  description:
    "Turns the text of a financial document (card invoice, bank statement, receipt) into proposed structured transactions, with a confidence grade and per-page location. Delegate when there is a document to interpret.",
  model: extractorModel(),
});
