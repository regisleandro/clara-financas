import type { OverviewResponse } from "@/lib/ledger-api";

export const ALL_ISSUERS = "todas";

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

/**
 * Traduz a resposta do serviço Python (`/api/ledger/overview`) para o que a
 * tela `/inicio` desenha — só formatação de rótulo em português, nenhum
 * cálculo. A soma, a comparação e a agregação por categoria já vieram
 * prontas de `clara/tools/overview.py`, a mesma função que a conversa usa.
 */
export function adaptOverview(response: OverviewResponse): Overview {
  const months = response.months.map((month) => ({ value: month, label: shortMonthLabel(month) }));
  const issuers = response.issuers.map((issuer) => ({ value: issuer.key, label: issuer.label }));
  const originLabel =
    response.selectedIssuer === ALL_ISSUERS
      ? "Todas as origens"
      : (issuers.find((issuer) => issuer.value === response.selectedIssuer)?.label ?? "Origem");

  if (response.selectedMonth === null) {
    return {
      selectedMonth: null,
      selectedIssuer: response.selectedIssuer,
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

  return {
    selectedMonth: response.selectedMonth,
    selectedIssuer: response.selectedIssuer,
    months,
    issuers,
    periodLabel: longMonthLabel(response.selectedMonth),
    originLabel,
    total: response.total,
    credits: response.credits,
    net: response.net,
    comparison:
      response.comparison === null
        ? null
        : {
            deltaPercent: response.comparison.deltaPercent,
            delta: response.comparison.delta,
            previousTotal: response.comparison.previousTotal,
            previousLabel: longMonthLabel(response.comparison.previousMonth).toLocaleLowerCase(
              "pt-BR",
            ),
          },
    spark: response.spark,
    rangeLabels:
      response.range === null
        ? { from: "", to: "" }
        : { from: dayLabel(response.range.from), to: dayLabel(response.range.to) },
    categories: response.categories.map((category) => ({
      label: category.label,
      value: category.value,
      share: category.share,
      countLabel: `${category.count} ${category.count === 1 ? "lançamento" : "lançamentos"}`,
    })),
    insight:
      response.insight === null
        ? null
        : {
            headline: `${capitalize(response.insight.label)} subiu ${Math.round(
              response.insight.deltaRatio * 100,
            )}%. É o que mais explica o mês.`,
            href: "/conversa",
          },
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
