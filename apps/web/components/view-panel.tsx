"use client";

import { formatCents } from "@clara-financas/ledger";
import type { View, ViewMetric, ViewRow } from "@clara-financas/views";
import { ArrowDownRight, ArrowUpRight, Check, Minus, TriangleAlert } from "lucide-react";

import {
  Artifact,
  ArtifactActions,
  ArtifactClose,
  ArtifactContent,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";

/**
 * Desenha o painel que a Clara escolheu.
 *
 * O componente não decide NADA sobre conteúdo — a forma vem no `kind`, os
 * rótulos vêm em português das ferramentas, e os números vêm em centavos. Toda
 * a inteligência de "o que mostrar" ficou do lado do agente, que é quem sabe o
 * que está respondendo. Aqui é só tipografia e hierarquia.
 */

const EYEBROW: Record<View["kind"], string> = {
  metric: "Resposta",
  breakdown: "Composição",
  comparison: "Comparação",
  recurrences: "Recorrências",
  transactions: "Razão",
  checksum: "Conferência",
};

export function ViewPanel({
  view,
  onClose,
  footer,
}: {
  view: View;
  onClose: () => void;
  /** Ações do gate (aprovar/rejeitar) quando há decisão pendente. */
  footer?: React.ReactNode;
}) {
  return (
    <aside
      className="hidden w-[480px] shrink-0 overflow-y-auto border-l bg-[var(--clara-white)] lg:block"
      style={{
        height: "calc(100svh - 3rem)",
        position: "sticky",
        top: "3rem",
        animation: "clara-slidein 0.28s ease",
      }}
      aria-label={EYEBROW[view.kind]}
    >
      <Artifact className="rounded-none border-0 bg-transparent">
        <ArtifactHeader className="items-start border-0 px-7 pb-5 pt-7">
          <div className="min-w-0">
            <p className="clara-eyebrow">{EYEBROW[view.kind]}</p>
            <ArtifactTitle className="clara-display-sm mt-1.5 text-foreground">
              {view.title}
            </ArtifactTitle>
            {view.summary !== undefined ? (
              <p className="clara-small mt-2">{view.summary}</p>
            ) : null}
          </div>
          <ArtifactActions>
            <ArtifactClose onClick={onClose} />
          </ArtifactActions>
        </ArtifactHeader>

        <ArtifactContent className="px-7 pb-14">
          {view.kind === "checksum" ? (
            <Checksum view={view} />
          ) : (
            <>
              {/* `recurrences` não tem métrica de topo — a lista JÁ é a
                  resposta, e um número em destaque acima dela competiria com o
                  que importa, que é cada assinatura e seu custo anual. */}
              {"metric" in view && view.metric !== undefined ? (
                <Metric metric={view.metric} />
              ) : null}
              <Rows
                rows={view.rows ?? []}
                showBars={view.kind === "breakdown"}
                columns={
                  view.kind === "comparison"
                    ? { previous: view.previousLabel, current: view.currentLabel }
                    : undefined
                }
              />
            </>
          )}

          {footer !== undefined ? <div className="mt-8">{footer}</div> : null}
        </ArtifactContent>
      </Artifact>
    </aside>
  );
}

/** O número herói: cartão próprio, tipografia grande. */
function Metric({ metric }: { metric: ViewMetric }) {
  const value =
    metric.amount !== undefined ? formatCents(metric.amount) : (metric.text ?? "—");

  return (
    <div className="rounded-[var(--clara-radius-card)] bg-[var(--clara-fog)] p-7">
      <p className="clara-eyebrow">{metric.label}</p>
      <p className="clara-metric mt-3.5">{value}</p>
      {metric.detail !== undefined ? (
        <p className="mt-1.5 text-[var(--clara-graphite)]">{metric.detail}</p>
      ) : null}
    </div>
  );
}

function Rows({
  rows,
  showBars,
  columns,
}: {
  rows: readonly ViewRow[];
  showBars: boolean;
  columns?: { previous: string; current: string };
}) {
  if (rows.length === 0) return null;

  return (
    <>
      {columns !== undefined ? (
        <p className="clara-eyebrow mt-10">
          {columns.previous} → {columns.current}
        </p>
      ) : null}

      <ul className={columns === undefined ? "mt-10" : "mt-3"}>
        {rows.map((row, index) => (
          <li
            key={`${row.label}-${index}`}
            className="border-b border-[var(--clara-fog)] py-4 last:border-0"
          >
            <div className="grid grid-cols-[1fr_auto] items-baseline gap-4">
              <span className="min-w-0">
                <strong className="block truncate font-semibold">{row.label}</strong>
                {row.detail !== undefined && row.detail !== "" ? (
                  <small className="clara-small mt-[3px] block">{row.detail}</small>
                ) : null}
              </span>
              <span className="flex items-center gap-1.5 tabular-nums">
                {row.trend !== undefined ? <Trend trend={row.trend} /> : null}
                {row.amount !== undefined ? formatCents(row.amount) : null}
              </span>
            </div>

            {/* A barra é proporção, não decoração: mostra o peso relativo sem
                exigir que a pessoa compare números de cabeça. */}
            {showBars && row.share !== undefined ? (
              <div
                className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-[var(--clara-fog)]"
                role="presentation"
              >
                <div
                  className="h-full rounded-full bg-[var(--clara-blue)]"
                  style={{ width: `${Math.round(row.share * 100)}%` }}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * `up` é vermelho porque, em gasto, subir é a notícia ruim. O sinal segue o
 * significado para a pessoa, não a direção da seta.
 */
function Trend({ trend }: { trend: NonNullable<ViewRow["trend"]> }) {
  if (trend === "flat") {
    return <Minus className="size-3.5 text-[var(--clara-slate)]" aria-label="estável" />;
  }
  if (trend === "up") {
    return (
      <ArrowUpRight className="size-3.5 text-[var(--clara-amber)]" aria-label="aumentou" />
    );
  }
  return (
    <ArrowDownRight className="size-3.5 text-[var(--clara-green)]" aria-label="diminuiu" />
  );
}

/**
 * A conferência (H2).
 *
 * Quando não bate, a DIFERENÇA vem primeiro e grande — é a única informação
 * que muda o que a pessoa faz a seguir. Os totais viram contexto embaixo.
 */
function Checksum({ view }: { view: Extract<View, { kind: "checksum" }> }) {
  const matched = view.result === "match";

  return (
    <>
      <div
        className="rounded-[var(--clara-radius-card)] p-7"
        style={{
          background: matched ? "var(--clara-fog)" : "color-mix(in srgb, var(--clara-amber) 8%, transparent)",
        }}
      >
        <p className="clara-eyebrow flex items-center gap-1.5">
          {matched ? (
            <Check className="size-3.5 text-[var(--clara-green)]" />
          ) : (
            <TriangleAlert className="size-3.5 text-[var(--clara-amber)]" />
          )}
          {matched ? "Total confere" : "Diferença encontrada"}
        </p>
        <p className="clara-metric mt-3.5">
          {matched ? formatCents(view.extractedTotal) : formatCents(view.difference)}
        </p>
        {view.cause !== undefined ? (
          <p className="mt-1.5 text-[var(--clara-graphite)]">{view.cause}</p>
        ) : null}
      </div>

      <ul className="mt-8">
        <li className="grid grid-cols-[1fr_auto] gap-4 border-b border-[var(--clara-fog)] py-3.5">
          <span className="clara-small">Total da fatura</span>
          <span className="tabular-nums">{formatCents(view.declaredTotal)}</span>
        </li>
        <li className="grid grid-cols-[1fr_auto] gap-4 py-3.5">
          <span className="clara-small">Total extraído</span>
          <span className="tabular-nums">{formatCents(view.extractedTotal)}</span>
        </li>
      </ul>

      <Rows rows={view.rows ?? []} showBars={false} />
    </>
  );
}
