import { defineDynamic, defineInstructions } from "eve/instructions";

import { loadSnapshot, renderSnapshot } from "../../../lib/snapshot";
import { requireTenantCaller } from "../../../lib/tenant";

/**
 * O mesmo estado, duplicado para o analista de propósito.
 *
 * Um subagente declarado não herda NADA do root — nem instruções, nem
 * ferramentas. É o que dá a garantia de isolamento do extrator, e o preço é
 * repetir aqui o que o filho também precisa.
 *
 * E ele precisa muito: era o analista que respondia "não há nada registrado"
 * depois de filtrar por um mês em que a fatura não caía, mandando a pessoa
 * reenviar um documento que já estava no razão. Com a cobertura e os ciclos
 * das faturas no contexto, o recorte deixa de ser adivinhação.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      let tenantId: string;
      try {
        ({ tenantId } = requireTenantCaller(ctx));
      } catch {
        return null;
      }

      const snapshot = await loadSnapshot(tenantId);
      return defineInstructions({ markdown: renderSnapshot(snapshot) });
    },
  },
});
