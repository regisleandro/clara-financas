/**
 * Vocabulário da revisão manual, sem `server-only`.
 *
 * Está separado de `lib/review.ts` porque os rótulos são VALOR em tempo de
 * execução e a tela da fila é um componente cliente: importá-los do módulo que
 * consulta o banco arrastaria o Drizzle para o bundle do navegador — e o
 * `server-only` recusaria o build, que é justamente o aviso funcionando.
 */

export const REVIEW_REASONS = ["sem_categoria", "confianca_baixa", "sem_comerciante"] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export const REASON_LABEL: Record<ReviewReason, string> = {
  sem_categoria: "Sem categoria",
  confianca_baixa: "Leitura duvidosa",
  sem_comerciante: "Comerciante não identificado",
};

export type ReviewItem = {
  id: string;
  date: string;
  /** O texto como está no documento — é contra ele que a pessoa confere. */
  originalDescription: string;
  merchant: string | null;
  category: string | null;
  categoryLabel: string;
  confidence: "alta" | "media" | "baixa";
  /** Centavos, sinalizado. */
  amount: number;
  page: number | null;
  issuer: string | null;
  filename: string | null;
  reasons: ReviewReason[];
};

export type DivergentBatch = {
  id: string;
  issuer: string | null;
  filename: string;
  periodLabel: string | null;
  /** `extraído − declarado`, em centavos. */
  difference: number | null;
  declaredTotal: number | null;
  extractedTotal: number | null;
};

export type UnnamedDocument = {
  id: string;
  filename: string;
  entryCount: number;
};

export type ReviewQueue = {
  items: ReviewItem[];
  divergentBatches: DivergentBatch[];
  unnamedDocuments: UnnamedDocument[];
  /** Categorias válidas para o seletor: constituição + o que a pessoa criou. */
  categories: Array<{ slug: string; label: string }>;
  counts: Record<ReviewReason, number>;
  /** Quantos itens já foram atestados — o denominador do progresso. */
  reviewedCount: number;
};

export type ActionResult = { ok: true } | { ok: false; error: string };
