"use client";

import { formatCents } from "@clara-financas/ledger";
import type { Basis, View, ViewMetric, ViewRow } from "@clara-financas/views";
import { ArrowDownRight, ArrowUpRight, Check, ChevronDown, Minus, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Provenance } from "@/components/provenance";
import { displayMetricValue } from "@/lib/money";

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
  series: "Evolução",
  recurrences: "Recorrências",
  transactions: "Razão",
  invoices: "Faturas",
  commitments: "Agenda",
  proposal: "Proposta",
  checksum: "Conferência",
};

/**
 * O que sustenta um número que NÃO é soma de lançamentos.
 *
 * Sem isto, um total declarado pelo documento e uma agregação do razão são a
 * mesma tipografia, e a diferença importa: um a pessoa confere clicando, o outro
 * ela confere no PDF. Uma projeção passando por soma é pior ainda — é o único
 * número do painel que fala do futuro.
 */
const BASIS_LABEL: Partial<Record<Basis, string>> = {
  document: "do documento",
  schedule: "agendado",
  projection: "projeção",
  delta: "diferença",
};

/** A cor do marcador de severidade. Segue o significado, não a estética. */
const ACCENT_COLOR: Record<NonNullable<ViewRow["accent"]>, string> = {
  danger: "var(--clara-amber)",
  attention: "var(--clara-blue)",
  positive: "var(--clara-green)",
};

/**
 * O conteúdo do painel, sem a moldura.
 *
 * Vive separado do `<aside>` porque a MESMA composição precisa aparecer em dois
 * lugares: fixa à direita na web, e dentro de uma modal em tela cheia no
 * celular. Quem escolhe a moldura é o `Chat`, conforme o tamanho da tela.
 */
export function ViewPanelInner({
  views,
  onClose,
  footer,
}: {
  /** Os painéis do turno, em ordem. O último é o que abre. */
  views: readonly View[];
  onClose: () => void;
  /** Ações do gate (aprovar/rejeitar) quando há decisão pendente. */
  footer?: React.ReactNode;
}) {
  // Abre no último e permite voltar. A Clara pode desenhar dois painéis numa
  // resposta — a proposta e o resultado —, e o anterior sumia sem sinal: o
  // texto falava de dois e só um existia.
  const [index, setIndex] = useState(Math.max(0, views.length - 1));
  const safeIndex = Math.min(index, views.length - 1);
  const view = views[safeIndex];
  if (view === undefined) return null;

  return (
    <Artifact className="h-full rounded-none border-0 bg-transparent">
        <ArtifactHeader className="min-w-0 items-start gap-3 border-0 px-7 pb-5 pt-7">
          <div className="min-w-0 flex-1">
            <p className="clara-eyebrow">{EYEBROW[view.kind]}</p>
            <ArtifactTitle className="clara-display-sm mt-1.5 break-words text-foreground [overflow-wrap:anywhere]">
              {view.title}
            </ArtifactTitle>
            {view.summary !== undefined ? (
              <p className="clara-small mt-2">{view.summary}</p>
            ) : null}
            {views.length > 1 ? (
              <nav className="mt-3 flex items-center gap-3" aria-label="Painéis desta resposta">
                <button
                  type="button"
                  onClick={() => setIndex(Math.max(0, safeIndex - 1))}
                  disabled={safeIndex === 0}
                  className="clara-link text-sm disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="clara-small tabular-nums">
                  {safeIndex + 1} de {views.length}
                </span>
                <button
                  type="button"
                  onClick={() => setIndex(Math.min(views.length - 1, safeIndex + 1))}
                  disabled={safeIndex === views.length - 1}
                  className="clara-link text-sm disabled:opacity-40"
                >
                  Próximo
                </button>
              </nav>
            ) : null}
          </div>
          <ArtifactActions className="shrink-0">
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
  );
}

/** O número herói: cartão próprio, tipografia grande. */
function Metric({ metric }: { metric: ViewMetric }) {
  const value = displayMetricValue(metric);

  return (
    <div className="min-w-0 rounded-[var(--clara-radius-card)] bg-[var(--clara-fog)] p-7 [container-type:inline-size]">
      <p className="clara-eyebrow">{metric.label}</p>
      <p className="clara-metric mt-3.5 max-w-full break-words [font-size:clamp(2rem,15cqi,4.5rem)] [overflow-wrap:anywhere]">
        {value}
      </p>
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
          <Row key={`${row.label}-${index}`} row={row} showBars={showBars} />
        ))}
      </ul>
    </>
  );
}

/**
 * Uma linha do painel — e, quando ela tem proveniência, o caminho até os
 * lançamentos que a compõem.
 *
 * Os `transactionIds` sempre estiveram aqui: o contrato os exige e recusa a
 * linha financeira que não os traga. O que faltava era a interface fazer algo
 * com eles. "Todo número deve poder ser conferido" era verdade no dado e
 * mentira na tela — a pessoa via R$ 1.240,00 em Restaurantes e não tinha como
 * perguntar quais almoços eram aqueles sem gastar um turno da conversa.
 */
function Row({ row, showBars }: { row: ViewRow; showBars: boolean }) {
  const [open, setOpen] = useState(false);
  const ids = row.transactionIds ?? [];
  const traceable = ids.length > 0;
  // `sum` não ganha nota: é o caso comum, e anotar todo número com "soma"
  // esconderia justamente os poucos que não são.
  const basisNote =
    row.amount !== undefined && row.basis !== undefined ? BASIS_LABEL[row.basis] : undefined;

  return (
          <li className="border-b border-[var(--clara-fog)] py-4 last:border-0">
            <div className="grid grid-cols-[minmax(0,11fr)_minmax(0,9fr)] items-baseline gap-4">
              <span className="min-w-0">
                <strong className="flex items-baseline gap-2 font-semibold">
                  {/* O marcador vem ANTES do rótulo: numa agenda, a urgência é
                      lida antes do nome de quem cobra. */}
                  {row.accent !== undefined ? (
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: ACCENT_COLOR[row.accent] }}
                    />
                  ) : null}
                  <span className="min-w-0 truncate">{row.label}</span>
                </strong>
                {row.detail !== undefined && row.detail !== "" ? (
                  <small className="clara-small mt-[3px] block">{row.detail}</small>
                ) : null}
                {traceable ? (
                  <button
                    type="button"
                    onClick={() => setOpen(!open)}
                    aria-expanded={open}
                    className="clara-link mt-1 inline-flex items-center gap-1 text-sm"
                  >
                    <ChevronDown
                      className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    />
                    {ids.length === 1 ? "Ver o lançamento" : `Ver os ${ids.length} lançamentos`}
                  </button>
                ) : null}
              </span>
              <span className="flex min-w-0 flex-col items-end gap-0.5 text-right">
                <span className="flex min-w-0 items-center justify-end gap-1.5 tabular-nums">
                  {row.trend !== undefined ? <Trend trend={row.trend} /> : null}
                  {row.amount !== undefined ? (
                    <span className="min-w-0 break-all">{formatCents(row.amount)}</span>
                  ) : null}
                </span>
                {/* Só quando a LINHA declarou: o padrão da forma já se lê no
                    título do painel ("Faturas", "Agenda"), e repetir a origem em
                    toda linha de uma conferência seria ruído. */}
                {basisNote !== undefined ? (
                  <small className="clara-small text-xs">{basisNote}</small>
                ) : null}
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

            {open ? <Provenance ids={ids} /> : null}
          </li>
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
  // Sem total declarado não há o que conferir automaticamente: o cartão fica
  // neutro, a métrica é o total extraído e a linha do total declarado mostra
  // "—" — nunca um R$ 0,00 que a fatura não disse.
  const noDeclared = view.result === "no_declared_total" || view.declaredTotal === null;

  return (
    <>
      <div
        className="min-w-0 rounded-[var(--clara-radius-card)] p-7 [container-type:inline-size]"
        style={{
          background:
            matched || noDeclared
              ? "var(--clara-fog)"
              : "color-mix(in srgb, var(--clara-amber) 8%, transparent)",
        }}
      >
        <p className="clara-eyebrow flex items-center gap-1.5">
          {matched ? (
            <Check className="size-3.5 text-[var(--clara-green)]" />
          ) : noDeclared ? (
            <Minus className="size-3.5 text-[var(--clara-slate)]" />
          ) : (
            <TriangleAlert className="size-3.5 text-[var(--clara-amber)]" />
          )}
          {matched
            ? "Total confere"
            : noDeclared
              ? "Sem total declarado"
              : "Diferença encontrada"}
        </p>
        <p className="clara-metric mt-3.5 max-w-full break-words [font-size:clamp(2rem,15cqi,4.5rem)] [overflow-wrap:anywhere]">
          {matched || noDeclared || view.difference === null
            ? formatCents(view.extractedTotal)
            : formatCents(view.difference)}
        </p>
        {view.cause !== undefined ? (
          <p className="mt-1.5 text-[var(--clara-graphite)]">{view.cause}</p>
        ) : noDeclared ? (
          <p className="mt-1.5 text-[var(--clara-graphite)]">
            O documento não traz um total para conferir — confira os lançamentos.
          </p>
        ) : null}
      </div>

      <ul className="mt-8">
        <li className="grid grid-cols-[minmax(0,11fr)_minmax(0,9fr)] gap-4 border-b border-[var(--clara-fog)] py-3.5">
          <span className="clara-small">Total da fatura</span>
          <span className="break-all text-right tabular-nums">
            {view.declaredTotal !== null ? formatCents(view.declaredTotal) : "—"}
          </span>
        </li>
        <li className="grid grid-cols-[minmax(0,11fr)_minmax(0,9fr)] gap-4 py-3.5">
          <span className="clara-small">Total extraído</span>
          <span className="break-all text-right tabular-nums">
            {formatCents(view.extractedTotal)}
          </span>
        </li>
      </ul>

      <Rows rows={view.rows ?? []} showBars={false} />
    </>
  );
}
