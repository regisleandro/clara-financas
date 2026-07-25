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
    "Transforma o texto de um documento financeiro (fatura de cartão, extrato, nota fiscal) em transações estruturadas propostas, com grau de confiança e localização por página. Delegue quando houver um documento a interpretar.",
  model: extractorModel(),
});
