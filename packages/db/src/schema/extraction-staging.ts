import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * A extração estacionada entre o extrator e a proposta de lote.
 *
 * Existe para a passagem por REFERÊNCIA: o extrator lia o PDF e devolvia as
 * 100+ linhas como saída estruturada, e a coordenadora precisava retranscrever
 * cada uma, token a token, no input de `propose_batch`. Custo de contexto
 * proporcional ao tamanho da fatura e risco de erro de cópia no elo mais
 * crítico do produto. O eve não tem referência nativa a saídas anteriores —
 * delegação é mensagem e resposta em texto — então a referência mora aqui:
 * o extrator persiste a extração completa, devolve só um recibo, e a
 * coordenadora propõe o lote a partir do `extractionId`.
 *
 * Não é razão. O rascunho de verdade continua sendo `batches`/`transactions`
 * com `status: proposed`; esta tabela é descartável por construção — a
 * proposta que a consome a apaga, e uma extração nova do mesmo documento
 * substitui a anterior. É também o que preserva a invariante do extrator:
 * ele ganha escrita AQUI, e continua sem alcançar o razão.
 */

/** O formato é o ExtractionResult de `@clara-financas/views/agent-contracts`;
 *  o banco o guarda opaco e a validação mora nas tools, na fronteira. */
export type ExtractionStagingPayload = {
  documentId: string;
  issuer: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  declaredTotal: number | null;
  declaredSubtotals: { fees: number | null; purchases: number | null } | null;
  transactions: Array<{
    date: string;
    originalDescription: string;
    merchant: string | null;
    amount: number;
    kind: "purchase" | "payment" | "refund" | "fee" | "adjustment";
    installment: { current: number; total: number } | null;
    category: string | null;
    extractionConfidence: "alta" | "media" | "baixa";
    page: number | null;
  }>;
  warnings: string[];
};

export const extractionStagings = pgTable(
  "extraction_stagings",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    documentId: text("document_id").notNull(),
    /**
     * A sessão do PAI no momento da delegação (`ctx.session.parent.sessionId`).
     * Chave de correlação que o modelo não digita — serve para diagnóstico e
     * para resolver "a extração desta conversa" sem depender de id transcrito.
     */
    parentSessionId: text("parent_session_id"),
    payload: jsonb("payload").$type<ExtractionStagingPayload>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("extraction_stagings_tenant_document_idx").on(table.tenantId, table.documentId),
    index("extraction_stagings_tenant_created_idx").on(table.tenantId, table.createdAt),
  ],
);
