import {
  aggregateByCategory,
  countsTowardDeclaredTotal,
  sumOf,
  categoryLabel,
  comparePeriods,
  issuerKey,
  spendable,
  totalSpend,
  type CategoryLabels,
  type Transaction,
} from "@clara-financas/ledger";

export const ALL_ISSUERS = "todas";

export type OverviewRow = Transaction & { documentIssuer: string | null };

export type Overview = {
  selectedMonth: string | null;
  selectedIssuer: string;
  months: Array<{ value: string; label: string }>;
  issuers: Array<{ value: string; label: string }>;
  periodLabel: string;
  originLabel: string;
  /** Compras do período — a mesma escala do painel da conversa. */
  total: number;
  /** Estornos e descontos, sempre negativos. Zero quando não houve. */
  credits: number;
  /** `total + credits`. O que sobra depois dos estornos. */
  net: number;
  comparison: {
    deltaPercent: number;
    delta: number;
    previousTotal: number;
    previousLabel: string;
  } | null;
  spark: number[];
  rangeLabels: { from: string; to: string };
  categories: Array<{ label: string; value: number; share: number; countLabel: string }>;
  insight: { headline: string; href: string } | null;
};

const longMonthLabel = (yearMonth: string) =>
  capitalize(
    new Intl.DateTimeFormat("pt-BR", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${yearMonth}-01T12:00:00Z`)),
  );

const shortMonthLabel = (yearMonth: string) =>
  capitalize(
    new Intl.DateTimeFormat("pt-BR", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
      .format(new Date(`${yearMonth}-01T12:00:00Z`))
      .replace(".", ""),
  );

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));

export function buildOverview(
  rows: OverviewRow[],
  labels: CategoryLabels,
  requested: { month?: string; issuer?: string } = {},
): Overview {
  const spending = spendable(rows);
  const months = [...new Set(spending.map((row) => row.date.slice(0, 7)))]
    .sort((a, b) => b.localeCompare(a))
    .map((month) => ({ value: month, label: shortMonthLabel(month) }));

  const issuerLabels = new Map<string, string>();
  for (const row of spending) {
    const key = issuerKey(row.documentIssuer);
    if (!issuerLabels.has(key)) {
      issuerLabels.set(key, row.documentIssuer ?? "Sem origem identificada");
    }
  }
  const issuers = [...issuerLabels.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  const selectedMonth = months.some((month) => month.value === requested.month)
    ? requested.month!
    : (months[0]?.value ?? null);
  const selectedIssuer =
    requested.issuer !== undefined && issuerLabels.has(requested.issuer)
      ? requested.issuer
      : ALL_ISSUERS;
  const originLabel =
    selectedIssuer === ALL_ISSUERS
      ? "Todas as origens"
      : (issuerLabels.get(selectedIssuer) ?? "Origem");

  if (selectedMonth === null) {
    return {
      selectedMonth: null,
      selectedIssuer,
      months,
      issuers,
      periodLabel: "—",
      originLabel,
      total: 0,
      credits: 0,
      net: 0,
      comparison: null,
      spark: [],
      rangeLabels: { from: "", to: "" },
      categories: [],
      insight: null,
    };
  }

  const originRows =
    selectedIssuer === ALL_ISSUERS
      ? spending
      : spending.filter((row) => issuerKey(row.documentIssuer) === selectedIssuer);
  const current = originRows.filter((row) => row.date.startsWith(selectedMonth));
  const previousMonth = shiftMonth(selectedMonth, -1);
  const previous = originRows.filter((row) => row.date.startsWith(previousMonth));
  /*
   * Compras, e não o líquido — a mesma escala que a conversa usa.
   *
   * O destaque desta tela era `totalSpend` (líquido, com estornos abatidos)
   * enquanto o painel da conversa passou a mostrar compras. A mesma pergunta
   * respondida por dois números, dependendo de onde a pessoa olhava. E a
   * curva ao lado do número já acumulava só positivos, então nem com ele mesmo
   * o destaque batia.
   *
   * Créditos e líquido não se perdem: vão nomeados, como no painel.
   */
  const compras = sumOf(current.filter((row) => countsTowardDeclaredTotal(row) && row.amount > 0));
  const creditos = sumOf(current.filter((row) => countsTowardDeclaredTotal(row) && row.amount < 0));
  const total = compras.value;
  const liquido = totalSpend(current).value;
  const previousTotal = sumOf(
    previous.filter((row) => countsTowardDeclaredTotal(row) && row.amount > 0),
  ).value;
  const currentDates = current.map((row) => row.date).sort();

  return {
    selectedMonth,
    selectedIssuer,
    months,
    issuers,
    periodLabel: longMonthLabel(selectedMonth),
    originLabel,
    total,
    credits: creditos.value,
    net: liquido,
    comparison:
      previousTotal === 0
        ? null
        : {
            deltaPercent:
              Math.round(((total - previousTotal) / previousTotal) * 1000) / 10,
            delta: total - previousTotal,
            previousTotal,
            previousLabel: longMonthLabel(previousMonth).toLocaleLowerCase("pt-BR"),
          },
    spark: buildSpark(current.map((row) => ({ date: row.date, amount: row.amount }))),
    rangeLabels:
      currentDates.length === 0
        ? { from: "", to: "" }
        : {
            from: dayLabel(currentDates[0]!),
            to: dayLabel(currentDates[currentDates.length - 1]!),
          },
    categories: aggregateByCategory(current)
      .filter((bucket) => bucket.gross.value > 0)
      .slice(0, 6)
      .map((bucket) => ({
        label: categoryLabel(labels, bucket.category),
        // Compras, como o destaque acima e como as barras do painel.
        value: bucket.gross.value,
        share: bucket.share,
        countLabel: `${bucket.count} ${
          bucket.count === 1 ? "lançamento" : "lançamentos"
        }`,
      })),
    insight: buildInsight(current, previous, labels),
  };
}

/** Gasto acumulado ao longo do período, em até 12 passos. */
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
  current: Transaction[],
  previous: Transaction[],
  labels: CategoryLabels,
): Overview["insight"] {
  if (previous.length === 0 || current.length === 0) return null;

  const { categories } = comparePeriods(current, previous);
  const leader = categories.find(
    (entry) =>
      entry.category !== null && entry.delta > 0 && entry.shareOfChange >= 0.25,
  );
  if (leader === undefined || leader.deltaRatio === null) return null;

  return {
    headline: `${capitalize(categoryLabel(labels, leader.category))} subiu ${Math.round(
      leader.deltaRatio * 100,
    )}%. É o que mais explica o mês.`,
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
