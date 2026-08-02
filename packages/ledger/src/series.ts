import { aggregateByCategory, totalSpend, type Provenance } from "./analysis";
import type { Transaction } from "./types";

export type FinancialPeriod = {
  id: string;
  label: string;
  transactions: Transaction[];
};

export type FinancialSeriesPoint = Provenance & {
  id: string;
  label: string;
};

export type FinancialSeriesDriver = {
  category: string | null;
  delta: number;
  transactionIds: string[];
  shareOfChange: number;
};

export type FinancialSeries = {
  points: FinancialSeriesPoint[];
  totalDelta: number;
  largest: FinancialSeriesPoint | null;
  smallest: FinancialSeriesPoint | null;
  drivers: FinancialSeriesDriver[];
};

/**
 * Compara vários períodos sem passar pelo modelo.
 *
 * A comparação de drivers usa o primeiro e o último período. O gráfico
 * continua mostrando todos os pontos, enquanto a narrativa recebe uma causa
 * determinística para a evolução observada.
 */
export function analyzeFinancialSeries(periods: FinancialPeriod[]): FinancialSeries {
  if (periods.length === 0) {
    return { points: [], totalDelta: 0, largest: null, smallest: null, drivers: [] };
  }

  /*
   * A ordem vem dos DADOS, não de como os períodos chegaram.
   *
   * `totalDelta` é "último menos primeiro" e os drivers comparam a primeira
   * fatura com a última. Enquanto isso dependia da ordem de ENTRADA, um modelo
   * que listasse do mais recente para o mais antigo — que é como uma pessoa
   * fala, "as três últimas faturas" — invertia o sinal da variação e fazia os
   * drivers explicarem a mudança ao contrário. O `InputSchema` só validava ids
   * únicos, então nada denunciava.
   *
   * A âncora é a data mais antiga de cada período. Recorte por fatura não tem
   * data comparável no próprio escopo (é um `batchId`), mas os lançamentos
   * têm — e são eles que definem o que veio antes.
   *
   * Período sem lançamento não tem âncora e fica no fim: ele contribui zero
   * para a série, e usá-lo como base tornaria a variação uma comparação contra
   * o vazio.
   */
  const cronologicos = [...periods].sort((left, right) => {
    const anchor = (period: FinancialPeriod) =>
      period.transactions.reduce<string | null>(
        (earliest, entry) => (earliest === null || entry.date < earliest ? entry.date : earliest),
        null,
      );
    const a = anchor(left);
    const b = anchor(right);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b);
  });

  const points = cronologicos.map((period) => {
    const total = totalSpend(period.transactions);
    return { id: period.id, label: period.label, value: total.value, transactionIds: total.transactionIds };
  });

  const first = cronologicos[0]!;
  const last = cronologicos.at(-1)!;
  const firstCategories = new Map(aggregateByCategory(first.transactions).map((row) => [row.category, row]));
  const lastCategories = new Map(aggregateByCategory(last.transactions).map((row) => [row.category, row]));
  const categories = new Set([...firstCategories.keys(), ...lastCategories.keys()]);
  const totalIncrease = [...categories].reduce((sum, category) => {
    const before = firstCategories.get(category)?.value ?? 0;
    const after = lastCategories.get(category)?.value ?? 0;
    return sum + Math.max(0, after - before);
  }, 0);

  const drivers = [...categories]
    .map((category) => {
      const before = firstCategories.get(category);
      const after = lastCategories.get(category);
      const delta = (after?.value ?? 0) - (before?.value ?? 0);
      return {
        category,
        delta,
        transactionIds: [...new Set([...(before?.transactionIds ?? []), ...(after?.transactionIds ?? [])])],
        shareOfChange: totalIncrease === 0 ? 0 : Math.max(0, delta) / totalIncrease,
      };
    })
    .sort((a, b) => b.delta - a.delta);

  return {
    points,
    totalDelta: points.at(-1)!.value - points[0]!.value,
    largest: points.reduce((largest, point) => (largest === null || point.value > largest.value ? point : largest), null as FinancialSeriesPoint | null),
    smallest: points.reduce((smallest, point) => (smallest === null || point.value < smallest.value ? point : smallest), null as FinancialSeriesPoint | null),
    drivers,
  };
}
