import "server-only";

import { aggregateByCategory, comparePeriods, totalSpend } from "@clara-financas/ledger";

import { loadLedgerView } from "@/lib/ledger";

/**
 * Dados da Visão geral.
 *
 * Tudo aqui deriva das mesmas funções que o analista usa. O painel não é uma
 * segunda implementação da verdade — se fosse, um número na tela e outro na
 * conversa acabariam divergindo, e a pessoa não teria como saber qual crer.
 */

export type Overview = {
  periodLabel: string;
  total: number;
  comparison: { deltaPercent: number; previousLabel: string } | null;
  spark: number[];
  rangeLabels: { from: string; to: string };
  categories: Array<{ label: string; value: number; share: number; countLabel: string }>;
  insight: { headline: string; href: string } | null;
};

const monthLabel = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );

export async function loadOverview(tenantId: string): Promise<Overview> {
  const { rows } = await loadLedgerView(tenantId);

  if (rows.length === 0) {
    return {
      periodLabel: "—",
      total: 0,
      comparison: null,
      spark: [],
      rangeLabels: { from: "", to: "" },
      categories: [],
      insight: null,
    };
  }

  const dates = rows.map((row) => row.date).sort();
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;

  // "Mês atual" é o mês do lançamento mais recente, não o do calendário: uma
  // fatura fechada em julho cobre gastos de maio e junho, e mostrar julho
  // vazio seria dizer que a pessoa não gastou nada.
  const currentMonth = last.slice(0, 7);
  const current = rows.filter((row) => row.date.startsWith(currentMonth));
  const previousMonth = shiftMonth(currentMonth, -1);
  const previous = rows.filter((row) => row.date.startsWith(previousMonth));

  const total = totalSpend(current).value;
  const previousTotal = totalSpend(previous).value;

  const categories = aggregateByCategory(current).slice(0, 6).map((bucket) => ({
    label: bucket.category ?? "sem categoria",
    value: bucket.value,
    share: bucket.share,
    countLabel: `${bucket.count} ${bucket.count === 1 ? "lançamento" : "lançamentos"}`,
  }));

  return {
    periodLabel: capitalize(monthLabel(`${currentMonth}-01`)),
    total,
    comparison:
      previousTotal === 0
        ? null
        : {
            deltaPercent: Math.round(((total - previousTotal) / previousTotal) * 1000) / 10,
            previousLabel: monthLabel(`${previousMonth}-01`),
          },
    spark: buildSpark(current.map((row) => ({ date: row.date, amount: row.amount }))),
    rangeLabels: { from: dayLabel(first), to: dayLabel(last) },
    categories,
    insight: buildInsight(current, previous),
  };
}

/**
 * Sparkline: gasto ACUMULADO ao longo do período, em 12 passos.
 *
 * Acumulado e não diário de propósito — o diário de um cartão é ruidoso
 * (dias sem compra viram zero) e a forma não diria nada. A curva acumulada
 * mostra ritmo, que é a pergunta real: "estou gastando mais rápido?".
 */
function buildSpark(entries: Array<{ date: string; amount: number }>): number[] {
  if (entries.length === 0) return [];

  const ordered = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const total = ordered.reduce((sum, entry) => sum + Math.max(0, entry.amount), 0);
  if (total === 0) return [];

  const steps = 12;
  const perStep = Math.ceil(ordered.length / steps);
  const result: number[] = [];
  let running = 0;

  for (let index = 0; index < ordered.length; index += 1) {
    running += Math.max(0, ordered[index]!.amount);
    if ((index + 1) % perStep === 0 || index === ordered.length - 1) {
      result.push(Math.round((running / total) * 100));
    }
  }

  return result.slice(0, steps);
}

function buildInsight(
  current: Parameters<typeof aggregateByCategory>[0],
  previous: Parameters<typeof aggregateByCategory>[0],
): Overview["insight"] {
  if (previous.length === 0 || current.length === 0) return null;

  const { categories } = comparePeriods(current, previous);
  const leader = categories.find(
    (entry) => entry.category !== null && entry.delta > 0 && entry.shareOfChange >= 0.25,
  );
  if (leader === undefined || leader.deltaRatio === null) return null;

  const percent = Math.round(leader.deltaRatio * 100);
  return {
    headline: `${capitalize(leader.category ?? "")} subiu ${percent}%. É o que mais explica o mês.`,
    href: "/conversa",
  };
}

function shiftMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
