import type { ChecksumReport, Confidence, ProposedBatch, Transaction } from "./types";

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
export function verifyChecksum(batch: ProposedBatch, toleranceCents = 0): ChecksumReport {
  const extractedTotal = sumAmounts(batch.transactions);

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

  return {
    result: "mismatch",
    extractedTotal,
    declaredTotal: batch.declaredTotal,
    difference,
    suspectItems: rankSuspects(batch.transactions, difference),
  };
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

  return candidates
    .sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      const byConfidence =
        CONFIDENCE_RANK[a.transaction.extractionConfidence] -
        CONFIDENCE_RANK[b.transaction.extractionConfidence];
      if (byConfidence !== 0) return byConfidence;
      return Math.abs(b.transaction.amount) - Math.abs(a.transaction.amount);
    })
    .filter(
      (candidate) => candidate.exact || candidate.transaction.extractionConfidence !== "alta",
    )
    .slice(0, 10)
    .map((candidate) => ({
      transactionId: candidate.transaction.id,
      reason: candidate.reason,
      confidence: candidate.transaction.extractionConfidence,
      amount: candidate.transaction.amount,
      page: candidate.transaction.page,
    }));
}

/** Formata centavos em BRL para exibição. Nunca usado em cálculo. */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
}
