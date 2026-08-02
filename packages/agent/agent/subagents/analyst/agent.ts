import { defineAgent } from "eve";
import { AnalysisDeliverySchema } from "@clara-financas/views/agent-contracts";

import { coordinatorModel } from "../../lib/models";

/**
 * O analista.
 *
 * Só autora tools de LEITURA e cálculo. Não existe aqui nenhuma tool que
 * escreva — e como subagente declarado não herda nada do root, isso é
 * garantia do compilador, não promessa.
 *
 * Usa o modelo econômico: o trabalho pesado é das tools determinísticas, e o
 * papel do modelo é interpretar e explicar, não calcular.
 */
export default defineAgent({
  description:
    "Answers spending questions from the ledger: composition by category, period comparison, recurrences, and subscriptions. Delegate when the person asks how much they spent, why it changed, or where they could save.",
  model: coordinatorModel(),
  reasoning: "medium",
  outputSchema: AnalysisDeliverySchema,
});
