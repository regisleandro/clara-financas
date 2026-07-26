import { defineDynamic, defineInstructions } from "eve/instructions";

import { loadSnapshot, renderSnapshot } from "../../../lib/snapshot";
import { requireTenantCaller } from "../../../lib/tenant";

/**
 * O mesmo estado, duplicado para o guarda-livros de propósito.
 *
 * Um subagente declarado não herda NADA do root — nem instruções, nem
 * ferramentas. É o que dá a garantia de isolamento, e o preço é repetir aqui
 * o que o filho também precisa: sem a cobertura e o `uncategorized.count` no
 * contexto, a triagem começaria às cegas e recortaria o período errado.
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
