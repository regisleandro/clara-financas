import { defineAgent } from "eve";

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
    "Responde perguntas sobre gastos a partir do razão: composição por categoria, comparação entre períodos, recorrências e assinaturas. Delegue quando a pessoa perguntar quanto gastou, por que mudou, ou onde pode economizar.",
  model: coordinatorModel(),
});
