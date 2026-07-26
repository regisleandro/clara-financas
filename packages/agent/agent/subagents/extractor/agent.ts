import { defineAgent } from "eve";
import { ExtractionReceiptSchema } from "@clara-financas/views/agent-contracts";

import { extractorModel } from "../../lib/models";

/**
 * O extrator.
 *
 * `description` é obrigatório: o pai lê exatamente este texto para decidir
 * quando delegar, então ele descreve o gatilho, não a implementação.
 *
 * Isolamento: um subagente declarado NÃO herda nada do root. Ele só alcança as
 * tools autoradas no próprio diretório — e nenhuma delas escreve no RAZÃO. A
 * única escrita é `save_extraction`, numa staging descartável sem grant sobre
 * `batches`/`transactions`: é o que permite a saída ser um RECIBO
 * (`ExtractionReceiptSchema`) em vez da fatura inteira. As 100+ linhas não
 * atravessam mais o contexto do coordenador — ele propõe o lote por
 * referência, com `propose_batch_from_extraction`.
 */
export default defineAgent({
  description:
    "Turns the text of a financial document (card invoice, bank statement, receipt) into proposed structured transactions, persisted server-side; returns a receipt with the extractionId. Delegate when there is a document to interpret.",
  model: extractorModel(),
  outputSchema: ExtractionReceiptSchema,
});
