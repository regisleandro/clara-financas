import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  INVOICE_REFERENCES,
  resolveInvoiceFocus,
} from "../lib/invoice-focus";
import { notFound } from "../lib/errors";
import { requireSessionCaller } from "../lib/tenant";

export default defineTool({
  description:
    "Resolves relational invoice references deterministically from persisted session focus. REQUIRED for 'essa/nesta fatura' (active), 'a última fatura' (latest), and 'a próxima fatura com divergência' (next_with_divergence). Returns one exact batchId and makes it the active invoice. Asking twice for the same reference returns the same invoice: next_with_divergence keeps the active invoice while it is still divergent. Never infer these references from transcript order.",
  inputSchema: z.object({
    reference: z.enum(INVOICE_REFERENCES),
    skipActive: z
      .boolean()
      .optional()
      .describe(
        "Only for next_with_divergence: move PAST the active invoice even if it is still divergent. Use only when the person asks for another one after this one.",
      ),
  }),
  async execute(input, ctx) {
    const { tenantId, sessionId } = requireSessionCaller(ctx);
    const invoice = await resolveInvoiceFocus(tenantId, sessionId, input.reference, {
      skipActive: input.skipActive,
    });

    if (invoice === null) {
      return notFound(
        "referencia_de_fatura_nao_encontrada",
        input.reference === "active"
          ? "Esta conversa ainda não tem uma fatura ativa."
          : input.reference === "latest"
            ? "Não há faturas disponíveis."
            : input.skipActive === true
              ? "Não há outra fatura com divergência depois da atual."
              : "Nenhuma fatura está com divergência em aberto.",
        {
          hint:
            input.reference === "active"
              ? "Use latest para abrir a fatura mais recente ou identifique uma fatura por emissor e ciclo."
              : "Não escolha outro lote por aproximação. Informe que não há uma fatura que corresponda a essa referência.",
        },
      );
    }

    return {
      resolvedFrom: input.reference,
      ...invoice,
      next: "Use este batchId nas próximas ferramentas. Chame read_batch para abrir os lançamentos ou a conferência.",
    };
  },
});
