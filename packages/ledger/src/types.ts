import { z } from "zod";

/**
 * Domínio determinístico do razão.
 *
 * Duas decisões que sustentam a hipótese H5 (números reproduzíveis):
 *
 * 1. **Dinheiro é inteiro em centavos.** Nunca ponto flutuante. `0.1 + 0.2`
 *    não é `0.3` em IEEE-754, e num assistente financeiro isso vira o pior
 *    tipo de erro: pequeno, plausível e invisível.
 *
 * 2. **Valor é sinalizado.** Despesa positiva, crédito negativo (pagamento,
 *    estorno, desconto). Assim a conferência é uma soma simples, sem regra
 *    especial por tipo — e regra especial é onde bug se esconde.
 */

/** Grau de confiança da extração de um item. */
export const CONFIDENCE = ["alta", "media", "baixa"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

/** Natureza da linha, para leitura humana. O sinal do valor é que manda. */
export const ENTRY_KINDS = [
  "purchase",
  "payment",
  "refund",
  "fee",
  "adjustment",
  "income",
  "transfer",
  "card_payment",
  "cash_withdrawal",
] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const InstallmentSchema = z.object({
  current: z.number().int().positive(),
  total: z.number().int().positive(),
});
export type Installment = z.infer<typeof InstallmentSchema>;

export const TransactionSchema = z.object({
  id: z.string().min(1),
  /** Data da compra, não a do fechamento da fatura. ISO 8601 (YYYY-MM-DD). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data deve ser YYYY-MM-DD"),
  /** O texto como aparece no documento. Nunca normalizado na extração. */
  originalDescription: z.string().min(1),
  merchant: z.string().nullable().default(null),
  /**
   * Identidade do comerciante, derivada por `merchantKey()` no momento da
   * proposta. É chave interna: agrupa entre faturas que escrevem o mesmo
   * comerciante de formas diferentes. Nunca é exibida — o que a pessoa lê é
   * `merchant`. `null` quando não há identidade a extrair.
   */
  merchantKey: z.string().nullable().default(null),
  /** Centavos, sinalizado: despesa > 0, crédito < 0. */
  amount: z.number().int(),
  kind: z.enum(ENTRY_KINDS).default("purchase"),
  installment: InstallmentSchema.nullable().default(null),
  category: z.string().nullable().default(null),
  extractionConfidence: z.enum(CONFIDENCE),
  sourceDocument: z.string().min(1),
  page: z.number().int().positive().nullable().default(null),
});
export type Transaction = z.infer<typeof TransactionSchema>;

/**
 * Lote proposto pelo extrator: metadados declarados do documento mais as
 * transações. Ainda não é o razão — vira razão só depois da aprovação.
 */
export const ProposedBatchSchema = z.object({
  documentId: z.string().min(1),
  documentKind: z
    .enum(["unknown", "credit_card_invoice", "bank_statement", "invoice_nfe"])
    .default("credit_card_invoice"),
  issuer: z.string().nullable().default(null),
  periodStart: z.string().nullable().default(null),
  periodEnd: z.string().nullable().default(null),
  dueDate: z.string().nullable().default(null),
  /**
   * Total declarado NO documento, em centavos. `null` quando o documento não
   * declara — caso legítimo, e que muda a conferência para integralmente
   * humana.
   */
  declaredTotal: z.number().int().nullable().default(null),
  /**
   * Subtotais que o documento declara no próprio resumo — ex.: "IOF de compras
   * internacionais R$ 35,17". São a chave para LOCALIZAR uma divergência: sem
   * eles só dá para dizer que a soma não bate; com eles, dá para dizer onde.
   */
  declaredSubtotals: z
    .object({
      fees: z.number().int().nullable().default(null),
      purchases: z.number().int().nullable().default(null),
    })
    .nullable()
    .default(null),
  openingBalance: z.number().int().nullable().default(null),
  closingBalance: z.number().int().nullable().default(null),
  transactions: z.array(TransactionSchema),
});
export type ProposedBatch = z.infer<typeof ProposedBatchSchema>;

export const CHECKSUM_RESULTS = ["match", "mismatch", "no_declared_total"] as const;
export type ChecksumResult = (typeof CHECKSUM_RESULTS)[number];

/**
 * Causa provável de uma divergência.
 *
 * Existe porque "menor confiança primeiro" não explica tudo: numa fatura real
 * de 48 lançamentos a diferença foi de 1 centavo, vinda do IOF — o emissor
 * calcula sobre o total e arredonda uma vez, nós somamos parcelas já
 * arredondadas. Listar itens suspeitos ali seria apontar para o lugar errado
 * com aparência de precisão.
 */
export const CHECKSUM_CAUSES = ["rounding", "item", "unknown"] as const;
export type ChecksumCause = (typeof CHECKSUM_CAUSES)[number];

export type ChecksumReport = {
  result: ChecksumResult;
  /** Só presente quando `result` é `mismatch`. */
  likelyCause?: ChecksumCause;
  /**
   * A folga aplicada, quando a causa provável foi arredondamento.
   *
   * "Arredondamento" era um veredito MUDO: a diferença sumia sem culpado e sem
   * dizer por quê. E a folga cresce com o número de itens — numa fatura de 48
   * lançamentos ela chega a 24 centavos —, então um erro de leitura pequeno o
   * bastante era absorvido e anunciado como se não existisse.
   *
   * A heurística continua: numa fatura real de 48 linhas a diferença de 1
   * centavo veio mesmo do IOF, que o emissor arredonda uma vez sobre o total
   * enquanto nós somamos parcelas já arredondadas. Apontar um culpado ali
   * inventaria precisão. O que muda é o silêncio — a folga passa a ser dita, e
   * quem lê pode discordar dela.
   */
  tolerance?: { cents: number; itemCount: number };
  /**
   * Onde a diferença está, quando o documento declara subtotais e um deles não
   * fecha. É a diferença entre "a conta não bate" e "a conta não bate no IOF".
   */
  localizedIn?: { area: "fees" | "purchases"; declared: number; extracted: number };
  /** Soma das transações extraídas, em centavos. */
  extractedTotal: number;
  declaredTotal: number | null;
  /** `extracted - declared`, em centavos. Positivo = extraímos demais. */
  difference: number | null;
  /**
   * Candidatos prováveis da divergência, do mais suspeito ao menos.
   * Vazio quando bateu.
   */
  suspectItems: Array<{
    transactionId: string;
    reason: string;
    confidence: Confidence;
    amount: number;
    page: number | null;
  }>;
};
