import { countsTowardDeclaredTotal } from "./checksum";
import type { Transaction } from "./types";

/**
 * Agregações do razão.
 *
 * Regra que atravessa o módulo inteiro: **todo número vem acompanhado dos IDs
 * das transações que o compõem.** Não é um extra de auditoria — é o que faz
 * "de onde veio esse valor?" ter resposta sempre, sem recalcular nada e sem
 * depender de o modelo lembrar de citar a origem.
 *
 * Nada aqui chama modelo. São funções puras sobre linhas já confirmadas, o que
 * as torna testáveis e reproduzíveis — a hipótese H5 depende disso.
 */

export type Provenance = {
  /** Centavos. */
  value: number;
  transactionIds: string[];
};

export type CategoryTotal = Provenance & {
  category: string | null;
  count: number;
  /** Fração do total do período, 0–1. Só para exibição. */
  share: number;
};

/** Lançamentos que representam gasto do período. Pagamento não é gasto. */
export function spendable(transactions: Transaction[]): Transaction[] {
  return transactions.filter(countsTowardDeclaredTotal);
}

export function totalSpend(transactions: Transaction[]): Provenance {
  const counted = spendable(transactions);
  return {
    value: counted.reduce((sum, transaction) => sum + transaction.amount, 0),
    transactionIds: counted.map((transaction) => transaction.id),
  };
}

/**
 * Composição por categoria, do maior para o menor.
 *
 * Transações sem categoria vêm como `category: null` em vez de serem
 * escondidas ou jogadas num "outros": o que ainda não foi categorizado é
 * justamente o que precisa de atenção.
 */
export function aggregateByCategory(transactions: Transaction[]): CategoryTotal[] {
  const counted = spendable(transactions);
  const total = counted.reduce((sum, transaction) => sum + transaction.amount, 0);
  const buckets = new Map<string | null, { value: number; ids: string[] }>();

  for (const transaction of counted) {
    const key = transaction.category ?? null;
    const bucket = buckets.get(key) ?? { value: 0, ids: [] };
    bucket.value += transaction.amount;
    bucket.ids.push(transaction.id);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([category, bucket]) => ({
      category,
      value: bucket.value,
      transactionIds: bucket.ids,
      count: bucket.ids.length,
      share: total === 0 ? 0 : bucket.value / total,
    }))
    .sort((a, b) => b.value - a.value);
}

export type CategoryComparison = {
  category: string | null;
  current: Provenance;
  previous: Provenance;
  /** `current - previous`, em centavos. */
  delta: number;
  /** Variação relativa, ou `null` quando não havia base anterior. */
  deltaRatio: number | null;
  /** Quanto esta categoria explica da variação total, 0–1. */
  shareOfChange: number;
};

/**
 * Comparação entre dois períodos, por categoria.
 *
 * `shareOfChange` é o que permite a frase "restaurantes explicam 62% do
 * aumento": é a contribuição da categoria para a variação total, e não a
 * variação dela isolada. Sem isso, uma categoria que dobrou de R$ 10 para
 * R$ 20 pareceria mais relevante que uma que subiu R$ 800.
 */
export function comparePeriods(
  current: Transaction[],
  previous: Transaction[],
): { totalDelta: number; categories: CategoryComparison[] } {
  const currentByCategory = index(aggregateByCategory(current));
  const previousByCategory = index(aggregateByCategory(previous));

  const categories = new Set([...currentByCategory.keys(), ...previousByCategory.keys()]);
  const totalDelta = totalSpend(current).value - totalSpend(previous).value;

  // Base da atribuição: só os aumentos. Misturar quedas diluiria a explicação
  // — se uma categoria cai e outra sobe, o total pode nem mudar, mas o
  // aumento continua tendo uma causa identificável.
  const increases = [...categories].map((category) => {
    const now = currentByCategory.get(category);
    const before = previousByCategory.get(category);
    return Math.max(0, (now?.value ?? 0) - (before?.value ?? 0));
  });
  const totalIncrease = increases.reduce((sum, value) => sum + value, 0);

  return {
    totalDelta,
    categories: [...categories]
      .map((category) => {
        const now = currentByCategory.get(category);
        const before = previousByCategory.get(category);
        const currentValue = now?.value ?? 0;
        const previousValue = before?.value ?? 0;
        const delta = currentValue - previousValue;

        return {
          category,
          current: { value: currentValue, transactionIds: now?.transactionIds ?? [] },
          previous: { value: previousValue, transactionIds: before?.transactionIds ?? [] },
          delta,
          deltaRatio: previousValue === 0 ? null : delta / previousValue,
          shareOfChange: totalIncrease === 0 ? 0 : Math.max(0, delta) / totalIncrease,
        };
      })
      .sort((a, b) => b.delta - a.delta),
  };
}

function index(totals: CategoryTotal[]): Map<string | null, CategoryTotal> {
  return new Map(totals.map((total) => [total.category, total]));
}

export type Recurrence = Provenance & {
  merchant: string;
  occurrences: number;
  /** Valor da cobrança mais recente, em centavos. */
  latestAmount: number;
  /** Valor da primeira cobrança observada. */
  firstAmount: number;
  /** Variação entre a primeira e a última, ou `null` se a primeira era zero. */
  priceChangeRatio: number | null;
  /** Intervalo mediano entre cobranças, em dias. */
  medianIntervalDays: number;
  /** Projeção anual pelo valor mais recente. */
  annualizedCents: number;
};

/**
 * Cobranças que se repetem no mesmo comerciante.
 *
 * O critério é intervalo regular, não valor igual: assinatura que reajustou
 * continua sendo assinatura — e é justamente a que interessa apontar.
 */
export function detectRecurrences(
  transactions: Transaction[],
  options: { minOccurrences?: number } = {},
): Recurrence[] {
  const minOccurrences = options.minOccurrences ?? 3;
  const byMerchant = new Map<string, Transaction[]>();

  for (const transaction of spendable(transactions)) {
    const merchant = transaction.merchant;
    if (merchant === null || merchant === "") continue;
    byMerchant.set(merchant, [...(byMerchant.get(merchant) ?? []), transaction]);
  }

  const recurrences: Recurrence[] = [];

  for (const [merchant, group] of byMerchant) {
    if (group.length < minOccurrences) continue;

    const ordered = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const intervals: number[] = [];
    for (let index = 1; index < ordered.length; index += 1) {
      intervals.push(daysBetween(ordered[index - 1]!.date, ordered[index]!.date));
    }

    const medianInterval = median(intervals);
    // Entre 3 e 5 semanas cobre mensal com variação de dia de fechamento.
    if (medianInterval < 21 || medianInterval > 38) continue;

    const first = ordered[0]!;
    const latest = ordered[ordered.length - 1]!;

    recurrences.push({
      merchant,
      occurrences: ordered.length,
      value: ordered.reduce((sum, transaction) => sum + transaction.amount, 0),
      transactionIds: ordered.map((transaction) => transaction.id),
      firstAmount: first.amount,
      latestAmount: latest.amount,
      priceChangeRatio: first.amount === 0 ? null : (latest.amount - first.amount) / first.amount,
      medianIntervalDays: medianInterval,
      annualizedCents: latest.amount * 12,
    });
  }

  return recurrences.sort((a, b) => b.annualizedCents - a.annualizedCents);
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;
}
