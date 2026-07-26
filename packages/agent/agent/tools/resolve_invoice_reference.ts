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
    "Resolves relational invoice references deterministically from persisted session focus. REQUIRED for 'essa/nesta fatura' (active), 'a última fatura' (latest), and 'a próxima fatura com divergência' (next_with_divergence). Returns one exact batchId and makes it the active invoice. Never infer these references from transcript order.",
  inputSchema: z.object({
    reference: z.enum(INVOICE_REFERENCES),
  }),
  async execute(input, ctx) {
    const { tenantId, sessionId } = requireSessionCaller(ctx);
    const invoice = await resolveInvoiceFocus(tenantId, sessionId, input.reference);

    if (invoice === null) {
      return notFound(
        "referencia_de_fatura_nao_encontrada",
        input.reference === "active"
          ? "Esta conversa ainda não tem uma fatura ativa."
          : input.reference === "latest"
            ? "Não há faturas disponíveis."
            : "Não há outra fatura com divergência depois da atual.",
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
