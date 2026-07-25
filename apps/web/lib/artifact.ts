import type { ArtifactData, ArtifactRow } from "@/components/artifact-panel";
import type { SubagentToolResult } from "@/lib/use-subagent-stream";

/**
 * Traduz resultados de ferramenta em artefato.
 *
 * A regra: só entra aqui número que veio de FERRAMENTA. O texto da Clara é
 * interpretação e pode ser reescrito a cada resposta; o artefato é o registro
 * do que foi calculado. Se os dois divergirem, o artefato manda.
 */

const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

type UnknownRecord = Record<string, unknown>;

const rec = (value: unknown): UnknownRecord | undefined =>
  typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export type BatchProposal = {
  batchId: string;
  transactionCount: number;
  issuer?: string | null;
  checksum: {
    result: "match" | "mismatch" | "no_declared_total";
    likelyCause?: "rounding" | "item" | "unknown";
    localizedIn?: { area: "fees" | "purchases"; declared: number; extracted: number };
    extractedTotal: number;
    declaredTotal: number | null;
    difference: number | null;
    suspectItems: Array<{
      transactionId: string;
      reason: string;
      confidence: "alta" | "media" | "baixa";
      amount: number;
      page: number | null;
    }>;
  };
};

const CAUSE_NOTE: Record<string, string> = {
  rounding:
    "Compatível com arredondamento: o emissor calcula sobre o total e arredonda uma vez, nós somamos parcelas já arredondadas. Não há item culpado.",
  item: "Um lançamento tem exatamente o valor da diferença — provável leitura duplicada ou faltante.",
  unknown: "Vale conferir os itens antes de aprovar.",
};

/** Artefato da conferência de um lote. */
export function batchArtifact(
  proposal: BatchProposal,
  actions: { onApprove: () => void; onReject: () => void; disabled: boolean },
): ArtifactData {
  const { checksum } = proposal;

  const rows: ArtifactRow[] = [
    {
      label: "Total declarado na fatura",
      value: checksum.declaredTotal === null ? "não declarado" : brl(checksum.declaredTotal),
    },
    { label: "Total das transações lidas", value: brl(checksum.extractedTotal) },
  ];

  if (checksum.difference !== null && checksum.difference !== 0) {
    rows.push({
      label: "Diferença",
      note: checksum.likelyCause ? CAUSE_NOTE[checksum.likelyCause] : undefined,
      value: brl(checksum.difference),
      emphasis: true,
    });
  }

  // Onde a diferença está, quando o documento declara subtotais. É o que
  // separa "a conta não bate" de "a conta não bate no IOF".
  if (checksum.localizedIn !== undefined) {
    const { area, declared, extracted } = checksum.localizedIn;
    rows.push({
      label: area === "fees" ? "Encargos e IOF" : "Compras",
      note: `a fatura declara ${brl(declared)}; as linhas somam ${brl(extracted)}`,
      value: brl(extracted - declared),
      emphasis: true,
    });
  }

  for (const item of checksum.suspectItems.slice(0, 4)) {
    rows.push({
      label: item.reason,
      note: item.page === null ? undefined : `página ${item.page}`,
      value: brl(item.amount),
    });
  }

  const status =
    checksum.result === "match"
      ? "Total confere"
      : checksum.result === "mismatch"
        ? "Diferença encontrada"
        : "Sem total declarado";

  return {
    title: proposal.issuer ?? "Documento",
    metricLabel: checksum.result === "match" ? "Total conferido" : "Total lido",
    metric: brl(checksum.extractedTotal),
    note: `${proposal.transactionCount} transações lidas · ${status.toLowerCase()}`,
    listTitle: "Conferência",
    rows,
    primaryAction: {
      label: "Registrar fatura",
      onClick: actions.onApprove,
      disabled: actions.disabled,
    },
    secondaryAction: { label: "Rejeitar lote", onClick: actions.onReject },
  };
}

/** Artefato de análise, a partir das ferramentas do analista. */
export function analysisArtifact(results: readonly SubagentToolResult[]): ArtifactData | null {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const item = results[index]!;
    const output = rec(item.output);
    if (output === undefined || output.empty === true) continue;

    if (item.toolName === "aggregate_by_category") {
      const cents = num(rec(output.total)?.cents);
      const categories = Array.isArray(output.categories) ? output.categories : [];
      if (cents === undefined || categories.length === 0) continue;

      const uncategorized = num(output.uncategorizedCount) ?? 0;
      return {
        title: "Composição do gasto",
        metricLabel: "Total no período",
        metric: brl(cents),
        note: `${categories.length} categorias${uncategorized > 0 ? ` · ${uncategorized} sem categoria` : ""}`,
        listTitle: "Por categoria",
        rows: categories.slice(0, 10).flatMap((entry): ArtifactRow[] => {
          const row = rec(entry);
          const value = str(row?.formatted);
          if (value === undefined) return [];
          const count = num(row?.count);
          const share = num(row?.sharePercent);
          return [
            {
              label: str(row?.category) ?? "sem categoria",
              note: [count && `${count} lançamentos`, share !== undefined && `${share}%`]
                .filter(Boolean)
                .join(" · "),
              value,
            },
          ];
        }),
        footnote: "Cada valor soma as transações confirmadas do período.",
      };
    }

    if (item.toolName === "compare_periods") {
      const cents = num(rec(output.totalDelta)?.cents);
      const categories = Array.isArray(output.categories) ? output.categories : [];
      if (cents === undefined) continue;

      return {
        title: "Comparação entre períodos",
        metricLabel: cents >= 0 ? "Aumento" : "Redução",
        metric: brl(Math.abs(cents)),
        note: `${str(rec(output.previousTotal)?.formatted) ?? "—"} → ${str(rec(output.currentTotal)?.formatted) ?? "—"}`,
        listTitle: "Quem explica a variação",
        rows: categories.slice(0, 10).flatMap((entry): ArtifactRow[] => {
          const row = rec(entry);
          const value = str(row?.deltaFormatted);
          if (value === undefined) return [];
          const explains = num(row?.explainsPercentOfIncrease);
          return [
            {
              label: str(row?.category) ?? "sem categoria",
              note:
                explains !== undefined && explains > 0
                  ? `explica ${explains}% do aumento`
                  : undefined,
              value,
            },
          ];
        }),
      };
    }

    if (item.toolName === "detect_recurrences") {
      const annual = num(output.totalAnnualizedCents);
      const recurrences = Array.isArray(output.recurrences) ? output.recurrences : [];
      if (annual === undefined || recurrences.length === 0) continue;

      return {
        title: "Recorrências",
        metricLabel: "Compromisso anual",
        metric: brl(annual),
        note: `${recurrences.length} cobranças que repetem todo mês`,
        listTitle: "Cobranças identificadas",
        rows: recurrences.slice(0, 10).flatMap((entry): ArtifactRow[] => {
          const row = rec(entry);
          const label = str(row?.merchant);
          const value = str(row?.latestFormatted);
          if (label === undefined || value === undefined) return [];
          const change = num(row?.priceChangePercent);
          const occurrences = num(row?.occurrences);
          return [
            {
              label,
              note: [
                occurrences && `${occurrences} cobranças`,
                change !== undefined && change !== 0
                  ? `${change > 0 ? "+" : ""}${change}% desde a primeira`
                  : null,
              ]
                .filter(Boolean)
                .join(" · "),
              value,
              emphasis: change !== undefined && change > 10,
            },
          ];
        }),
      };
    }

    if (item.toolName === "query_ledger") {
      const total = rec(output.total);
      const transactions = Array.isArray(output.transactions) ? output.transactions : [];
      const cents = num(total?.cents);
      if (cents === undefined || transactions.length === 0) continue;

      return {
        title: "Transações",
        metricLabel: "Soma do recorte",
        metric: brl(cents),
        note: `${num(output.matched) ?? transactions.length} lançamentos`,
        listTitle: "Lançamentos",
        rows: transactions.slice(0, 12).flatMap((entry): ArtifactRow[] => {
          const row = rec(entry);
          const amount = num(row?.amountCents);
          const label = str(row?.merchant) ?? str(row?.description);
          if (amount === undefined || label === undefined) return [];
          return [
            {
              label,
              note: [str(row?.date), str(row?.category)].filter(Boolean).join(" · "),
              value: brl(amount),
            },
          ];
        }),
      };
    }
  }

  return null;
}
