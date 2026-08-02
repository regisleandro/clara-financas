import { defineAgent } from "eve";

import { coordinatorModel, contextWindowTokens } from "./lib/models";

export default defineAgent({
  model: coordinatorModel(),
  // O Terra oferece o melhor equilíbrio de custo para este fluxo. Fixamos o
  // esforço para que mudanças de default do provider não alterem qualidade,
  // latência ou custo silenciosamente entre ambientes.
  reasoning: "medium",
  // Obrigatório quando o modelo não é um ID que o AI Gateway já conhece: sem
  // isto o eve recusa compilar a compactação, por não saber o tamanho da
  // janela. Ajuste conforme o modelo escolhido.
  modelContextWindowTokens: contextWindowTokens(),
});
