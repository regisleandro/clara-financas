"use client";

import {
  Artifact,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import type { SubagentToolResult } from "@/lib/use-subagent-stream";

/**
 * Artefato de análise.
 *
 * Vem dos resultados das ferramentas do ANALISTA, lidos na sessão filha. Isso
 * importa: os números aqui são os que a ferramenta determinística devolveu,
 * não os que o modelo escreveu em prosa. Se o texto e o artefato divergirem, o
 * artefato é o certo — e essa é a razão de ele existir.
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

type Row = { label: string; note?: string; value: string };

type Rendered = {
  title: string;
  description?: string;
  metricLabel: string;
  metric: string;
  note?: string;
  rows: Row[];
};

/** Escolhe o último resultado que dá um artefato, na ordem que o design pede. */
function render(results: readonly SubagentToolResult[]): Rendered | null {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const item = results[index]!;
    const output = rec(item.output);
    if (output === undefined || output.empty === true) continue;

    if (item.toolName === "aggregate_by_category") {
      const total = rec(output.total);
      const categories = Array.isArray(output.categories) ? output.categories : [];
      const cents = num(total?.cents);
      if (cents === undefined || categories.length === 0) continue;

      return {
        title: "Composição por categoria",
        description: `${categories.length} categorias`,
        metricLabel: "Total no período",
        metric: brl(cents),
        note:
          num(output.uncategorizedCount) !== undefined && num(output.uncategorizedCount)! > 0
            ? `${output.uncategorizedCount} lançamentos ainda sem categoria`
            : undefined,
        rows: categories.slice(0, 8).flatMap((entry) => {
          const row = rec(entry);
          const label = str(row?.category) ?? "sem categoria";
          const value = str(row?.formatted);
          if (value === undefined) return [];
          const count = num(row?.count);
          const share = num(row?.sharePercent);
          return [
            {
              label,
              note: [
                count === undefined ? null : `${count} lançamentos`,
                share === undefined ? null : `${share}%`,
              ]
                .filter(Boolean)
                .join(" · "),
              value,
            },
          ];
        }),
      };
    }

    if (item.toolName === "compare_periods") {
      const delta = rec(output.totalDelta);
      const cents = num(delta?.cents);
      const categories = Array.isArray(output.categories) ? output.categories : [];
      if (cents === undefined) continue;

      return {
        title: "Comparação entre períodos",
        metricLabel: cents >= 0 ? "Aumento no período" : "Redução no período",
        metric: brl(Math.abs(cents)),
        rows: categories.slice(0, 8).flatMap((entry) => {
          const row = rec(entry);
          const label = str(row?.category) ?? "sem categoria";
          const value = str(row?.deltaFormatted);
          if (value === undefined) return [];
          const explains = num(row?.explainsPercentOfIncrease);
          return [
            {
              label,
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
        description: `${recurrences.length} cobranças identificadas`,
        metricLabel: "Compromisso anual",
        metric: brl(annual),
        rows: recurrences.slice(0, 8).flatMap((entry) => {
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
                occurrences === undefined ? null : `${occurrences} cobranças`,
                change === undefined || change === 0
                  ? null
                  : `${change > 0 ? "+" : ""}${change}% desde a primeira`,
              ]
                .filter(Boolean)
                .join(" · "),
              value,
            },
          ];
        }),
      };
    }
  }

  return null;
}

export function AnalysisArtifact({ results }: { results: readonly SubagentToolResult[] }) {
  const data = render(results);
  if (data === null) return null;

  return (
    <Artifact className="w-full">
      <ArtifactHeader>
        <div>
          <ArtifactTitle>{data.title}</ArtifactTitle>
          {data.description !== undefined ? (
            <ArtifactDescription>{data.description}</ArtifactDescription>
          ) : null}
        </div>
      </ArtifactHeader>

      <ArtifactContent className="space-y-6">
        <div>
          <p className="clara-eyebrow">{data.metricLabel}</p>
          <p className="clara-metric mt-2">{data.metric}</p>
          {data.note !== undefined ? (
            <p className="clara-small mt-1">{data.note}</p>
          ) : null}
        </div>

        <ul>
          {data.rows.map((row) => (
            <li
              key={row.label}
              className="grid grid-cols-[1fr_auto] items-center gap-4 border-b py-4 last:border-0"
            >
              <span className="min-w-0">
                <strong className="block truncate font-semibold">{row.label}</strong>
                {row.note !== undefined && row.note !== "" ? (
                  <small className="clara-small mt-[3px] block">{row.note}</small>
                ) : null}
              </span>
              <span className="tabular-nums">{row.value}</span>
            </li>
          ))}
        </ul>
      </ArtifactContent>
    </Artifact>
  );
}
