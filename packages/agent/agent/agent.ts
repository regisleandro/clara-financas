import { defineAgent } from "eve";

import { coordinatorModel, contextWindowTokens } from "./lib/models";

export default defineAgent({
  model: coordinatorModel(),
  // Obrigatório quando o modelo não é um ID que o AI Gateway já conhece: sem
  // isto o eve recusa compilar a compactação, por não saber o tamanho da
  // janela. Ajuste conforme o modelo escolhido.
  modelContextWindowTokens: contextWindowTokens(),
});
