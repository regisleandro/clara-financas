import { disableTool } from "eve/tools";

/**
 * Desabilita o `load_skill` do harness padrão.
 *
 * Mesmo motivo dos outros agentes: um modelo diante de uma ferramenta que
 * promete "carregar capacidades" inventa nomes. O analista já entrou em laço
 * chamando uma skill inexistente e queimou o turno inteiro sem responder.
 *
 * Remover este arquivo quando houver skills de verdade em `skills/`.
 */
export default disableTool();
