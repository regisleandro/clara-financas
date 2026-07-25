import { disableTool } from "eve/tools";

/**
 * Desabilita o `load_skill` do harness padrão.
 *
 * Nenhum agente deste projeto autora skills ainda, mas o eve expõe a tool
 * assim mesmo — e um modelo diante de uma ferramenta que promete "carregar
 * capacidades" inventa nomes. Observado na prática: o analista entrou em laço
 * chamando `load_skill("obter_periodo_fatura_atual")`, uma skill que nunca
 * existiu, e queimou o turno inteiro sem responder.
 *
 * Remover este arquivo quando houver skills de verdade em `skills/`.
 */
export default disableTool();
