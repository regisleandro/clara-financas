import { defineAgent } from "eve";
import { CategorizationDeliverySchema } from "@clara-financas/views/agent-contracts";

import { coordinatorModel } from "../../lib/models";

/**
 * O guarda-livros.
 *
 * Concentra a coerência da categorização: triagem do que ficou sem categoria,
 * alcance das regras aprendidas e grafias divergentes do mesmo comerciante.
 * Antes este trabalho ficava espalhado entre a Clara e o analista — e o
 * analista carregava um parser de regras próprio, duplicado do domínio, que
 * já tinha divergido (uma regra com merchant vazio casava com o razão inteiro).
 *
 * Só autora tools de LEITURA: devolve propostas com transactionIds; quem
 * escreve é a Clara, pelas tools com gate de aprovação. Como subagente
 * declarado não herda nada do root, isso é garantia do compilador, não
 * promessa.
 */
export default defineAgent({
  // `description` é obrigatório: o pai lê exatamente este texto para decidir
  // quando delegar, então ele descreve o gatilho, não a implementação.
  description:
    "Keeps categorisation coherent: triages uncategorised spending, reports which learned rules would reach it, and spots the same merchant written under different spellings. Read-only — it returns proposals with transaction ids; every write goes back through the coordinator's approval tools. Delegate when uncategorised spending needs triage, when a correction might become a rule, or when two spellings look like the same merchant.",
  model: coordinatorModel(),
  reasoning: "medium",
  outputSchema: CategorizationDeliverySchema,
});
