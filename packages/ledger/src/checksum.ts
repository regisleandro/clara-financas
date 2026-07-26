import type {
  ChecksumCause,
  ChecksumReport,
  Confidence,
  ProposedBatch,
  Transaction,
} from "./types";

/**
 * A conferência: soma das transações extraídas contra o total declarado.
 *
 * É o diferencial do domínio — o documento carrega a própria prova. Bateu, a
 * extração está validada matematicamente, não por confiança no modelo.
 * Divergiu, temos um diagnóstico: quanto falta e onde provavelmente está.
 *
 * Sem tolerância por padrão, e de propósito: dinheiro bate ao centavo. Uma
 * tolerância "só para arredondar" é como erro de extração passa despercebido.
 */
/**
 * Quais lançamentos compõem o total declarado.
 *
 * Descoberto contra uma fatura real: o **pagamento da fatura anterior** aparece
 * na lista de lançamentos, mas NÃO entra no total desta fatura — ele quita o
 * ciclo passado. Estorno entra (é crédito contra uma compra do período);
 * encargo entra; pagamento não.
 *
 * Somar tudo indiscriminadamente produzia uma divergência do tamanho exato do
 * pagamento — R$ 3.251,62 numa fatura de R$ 4.387,92 — que parecia erro de
 * extração e era erro de modelo.
 */
export function countsTowardDeclaredTotal(transaction: Transaction): boolean {
  return transaction.kind !== "payment";
}

export function verifyChecksum(
  batch: ProposedBatch,
  toleranceCents = 0,
  rounding: RoundingPolicy = DEFAULT_ROUNDING,
): ChecksumReport {
  const counted = batch.transactions.filter(countsTowardDeclaredTotal);
  const extractedTotal = sumAmounts(counted);

  if (batch.declaredTotal === null) {
    return {
      result: "no_declared_total",
      extractedTotal,
      declaredTotal: null,
      difference: null,
      // Sem total declarado não há divergência a explicar; a conferência é
      // integralmente humana e o cartão sinaliza isso.
      suspectItems: [],
    };
  }

  const difference = extractedTotal - batch.declaredTotal;

  if (Math.abs(difference) <= toleranceCents) {
    return {
      result: "match",
      extractedTotal,
      declaredTotal: batch.declaredTotal,
      difference,
      suspectItems: [],
    };
  }

  const exactMatch = counted.some((transaction) => transaction.amount === difference);
  const likelyCause = classifyCause(difference, counted.length, exactMatch, rounding);
  const localizedIn = localize(batch, counted);

  return {
    result: "mismatch",
    likelyCause,
    ...(localizedIn === null ? {} : { localizedIn }),
    extractedTotal,
    declaredTotal: batch.declaredTotal,
    difference,
    // Arredondamento não tem culpado: listar suspeitos ali seria apontar para
    // o lugar errado com aparência de precisão.
    // Só os lançamentos que compõem o total podem explicar a divergência.
    suspectItems: likelyCause === "rounding" ? [] : rankSuspects(counted, difference),
  };
}

/**
 * Onde a diferença mora.
 *
 * Faturas declaram subtotais no resumo ("IOF de compras internacionais
 * R$ 35,17"). Comparar cada subtotal com a soma das linhas do mesmo tipo
 * transforma "a conta não bate" em "a conta não bate no IOF" — que é a
 * diferença entre um alarme e um diagnóstico.
 *
 * Verificado numa fatura real: 7 linhas de IOF somando R$ 35,16 contra
 * R$ 35,17 declarados. Sem isto, o sistema sabia que faltava 1 centavo e não
 * sabia dizer onde.
 */
function localize(
  batch: ProposedBatch,
  counted: Transaction[],
): ChecksumReport["localizedIn"] | null {
  const declared = batch.declaredSubtotals;
  if (declared === null || declared === undefined) return null;

  const sumOf = (predicate: (t: Transaction) => boolean) =>
    counted.filter(predicate).reduce((total, t) => total + t.amount, 0);

  if (declared.fees !== null && declared.fees !== undefined) {
    const extracted = sumOf((t) => t.kind === "fee");
    if (extracted !== declared.fees) {
      return { area: "fees", declared: declared.fees, extracted };
    }
  }

  if (declared.purchases !== null && declared.purchases !== undefined) {
    const extracted = sumOf((t) => t.kind === "purchase");
    if (extracted !== declared.purchases) {
      return { area: "purchases", declared: declared.purchases, extracted };
    }
  }

  return null;
}

/**
 * Poucos centavos espalhados por muitos lançamentos é assinatura de
 * arredondamento acumulado, não de item lido errado — um item errado erra por
 * ordens de grandeza maiores. O limiar cresce com a quantidade de itens porque
 * cada um pode contribuir com meio centavo.
 *
 * É heurística, e heurística com número fixo escondido no meio do arquivo é
 * exatamente o tipo de decisão que ninguém consegue revisar depois. Fica aqui,
 * nomeada e substituível: `verifyChecksum` aceita outra política, e o dia em
 * que um emissor exigir tolerância diferente não vai precisar de um `if` novo
 * dentro do cálculo.
 */
export type RoundingPolicy = {
  /** Piso, em centavos: abaixo disto a diferença é sempre arredondamento. */
  floorCents: number;
  /** Quanto cada item pode contribuir, em centavos. */
  perItemCents: number;
};

export const DEFAULT_ROUNDING: RoundingPolicy = { floorCents: 2, perItemCents: 0.5 };

function classifyCause(
  difference: number,
  itemCount: number,
  hasExactMatch: boolean,
  rounding: RoundingPolicy,
): ChecksumCause {
  if (hasExactMatch) return "item";

  const tolerance = Math.max(rounding.floorCents, Math.ceil(itemCount * rounding.perItemCents));
  if (Math.abs(difference) <= tolerance) return "rounding";

  return "unknown";
}

/** Soma em inteiros. Nenhum ponto flutuante toca em dinheiro. */
export function sumAmounts(transactions: Transaction[]): number {
  return transactions.reduce((total, transaction) => total + transaction.amount, 0);
}

const CONFIDENCE_RANK: Record<Confidence, number> = { baixa: 0, media: 1, alta: 2 };

/**
 * Ordena os candidatos prováveis da divergência.
 *
 * A heurística tem uma ordem deliberada:
 *  1. Um item cujo valor é exatamente a diferença é quase certamente a causa
 *     (item lido a mais, ou a menos). Vem primeiro, qualquer que seja a
 *     confiança.
 *  2. Depois, menor confiança primeiro — é onde o extrator já se declarou
 *     inseguro.
 *  3. Empate resolve por valor absoluto: erro grande importa mais.
 */
function rankSuspects(
  transactions: Transaction[],
  difference: number,
): ChecksumReport["suspectItems"] {
  const candidates = transactions.map((transaction) => {
    const exact = transaction.amount === difference;
    return {
      transaction,
      exact,
      reason: exact
        ? "o valor deste item é exatamente a diferença — provável leitura duplicada ou faltante"
        : `confiança ${transaction.extractionConfidence} na extração`,
    };
  });

  const sorted = candidates.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    const byConfidence =
      CONFIDENCE_RANK[a.transaction.extractionConfidence] -
      CONFIDENCE_RANK[b.transaction.extractionConfidence];
    if (byConfidence !== 0) return byConfidence;
    return Math.abs(b.transaction.amount) - Math.abs(a.transaction.amount);
  });

  const flagged = sorted.filter(
    (candidate) => candidate.exact || candidate.transaction.extractionConfidence !== "alta",
  );

  // Quando o extrator se declarou seguro de tudo e ainda assim não fecha, o
  // erro está em algum lugar — devolver lista vazia diante de uma divergência
  // grande deixaria a pessoa sem por onde começar. Nesse caso mostramos os
  // maiores valores, que são onde um erro pesa mais.
  const chosen =
    flagged.length > 0
      ? flagged
      : sorted.map((candidate) => ({
          ...candidate,
          reason: "nada se destacou; este é um dos maiores valores do lote",
        }));

  return chosen
    .slice(0, 10)
    .map((candidate) => ({
      transactionId: candidate.transaction.id,
      reason: candidate.reason,
      confidence: candidate.transaction.extractionConfidence,
      amount: candidate.transaction.amount,
      page: candidate.transaction.page,
    }));
}

const BRL_FORMATTER = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formata centavos em `R$ #.###,##` para exibição. Nunca usado em cálculo. */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new TypeError("formatCents exige um valor inteiro em centavos.");
  }
  // `Intl` usa NBSP entre a moeda e o número. Visualmente é igual, mas
  // normalizar para espaço deixa cópia, snapshot e testes no mesmo padrão.
  return BRL_FORMATTER.format(cents / 100).replace(/\u00a0/g, " ");
}
