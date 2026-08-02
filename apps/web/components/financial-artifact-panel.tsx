"use client";

import type { FinancialArtifact, FinancialArtifactBlock } from "@clara-financas/views";
import { Check, Minus, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Artifact, ArtifactActions, ArtifactClose, ArtifactContent, ArtifactHeader, ArtifactTitle } from "@/components/ai-elements/artifact";
import { Provenance } from "@/components/provenance";
import { formatCents } from "@clara-financas/ledger";

export function FinancialArtifactPanelInner({
  artifacts,
  onClose,
}: {
  artifacts: readonly FinancialArtifact[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(Math.max(0, artifacts.length - 1));
  const artifact = artifacts[Math.min(index, artifacts.length - 1)];
  if (artifact === undefined) return null;

  return (
    <Artifact className="h-full rounded-none border-0 bg-transparent">
      <ArtifactHeader className="min-w-0 items-start gap-3 border-0 px-7 pb-5 pt-7">
        <div className="min-w-0 flex-1">
          <p className="clara-eyebrow">Detalhes financeiros</p>
          <ArtifactTitle className="clara-display-sm mt-1.5 break-words text-foreground [overflow-wrap:anywhere]">
            {artifact.title}
          </ArtifactTitle>
          <p className="clara-small mt-2">{artifact.summary}</p>
          {artifacts.length > 1 ? (
            <nav className="mt-3 flex items-center gap-3" aria-label="Análises desta resposta">
              <button type="button" className="clara-link text-sm disabled:opacity-40" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>Anterior</button>
              <span className="clara-small tabular-nums">{index + 1} de {artifacts.length}</span>
              <button type="button" className="clara-link text-sm disabled:opacity-40" disabled={index === artifacts.length - 1} onClick={() => setIndex((value) => Math.min(artifacts.length - 1, value + 1))}>Próxima</button>
            </nav>
          ) : null}
        </div>
        <ArtifactActions className="shrink-0"><ArtifactClose onClick={onClose} /></ArtifactActions>
      </ArtifactHeader>
      <ArtifactContent className="space-y-8 px-7 pb-14">
        {artifact.blocks.map((block, blockIndex) => <Block key={`${block.type}-${blockIndex}`} block={block} />)}
        {artifact.warnings.length > 0 ? <p className="clara-small">Avisos: {artifact.warnings.join(" · ")}</p> : null}
      </ArtifactContent>
    </Artifact>
  );
}

function Block({ block }: { block: FinancialArtifactBlock }) {
  if (block.type === "metric") {
    return (
      <section className="rounded-[var(--clara-radius-card)] bg-[var(--clara-fog)] p-7">
        <p className="clara-eyebrow">{block.label}</p>
        <p className="clara-metric mt-3.5 break-words [overflow-wrap:anywhere]">
          {block.amount === undefined ? block.text ?? "—" : formatCents(block.amount)}
        </p>
        {block.detail ? <p className="mt-1.5 text-[var(--clara-graphite)]">{block.detail}</p> : null}
        <Trace ids={block.provenance.transactionIds} />
      </section>
    );
  }
  if (block.type === "series") {
    const maximum = Math.max(1, ...block.points.map((point) => Math.abs(point.amount)));
    return (
      <section>
        <h3 className="clara-display-xs">{block.title}</h3>
        <ul className="mt-4 space-y-4">
          {block.points.map((point) => <li key={point.periodId}>
            <div className="flex items-baseline justify-between gap-3"><strong>{point.label}</strong><span className="tabular-nums">{formatCents(point.amount)}</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--clara-fog)]"><div className="h-full rounded-full bg-[var(--clara-blue)]" style={{ width: `${Math.max(2, Math.round((Math.abs(point.amount) / maximum) * 100))}%` }} /></div>
            <Trace ids={point.provenance.transactionIds} />
          </li>)}
        </ul>
      </section>
    );
  }
  if (block.type === "breakdown") {
    return <section><h3 className="clara-display-xs">{block.title}</h3><ul className="mt-3">{block.rows.map((row) => <ArtifactRow key={row.label} label={row.label} amount={row.amount} detail={row.detail} share={row.share} ids={row.provenance.transactionIds} />)}</ul></section>;
  }
  if (block.type === "table") {
    return <section><h3 className="clara-display-xs">{block.title}</h3><div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr>{block.columns.map((column) => <th key={column} className="border-b px-2 py-2 text-left font-semibold">{column}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={index}>{row.cells.map((cell, cellIndex) => <td key={cellIndex} className="border-b px-2 py-2 align-top">{cell}</td>)}</tr>)}</tbody></table></div>{block.rows.map((row, index) => <Trace key={`trace-${index}`} ids={row.provenance.transactionIds} />)}</section>;
  }
  return <section className="rounded-[var(--clara-radius-card)] bg-[var(--clara-fog)] p-6"><p className="clara-eyebrow flex items-center gap-1.5">{block.result === "match" ? <Check className="size-3.5 text-[var(--clara-green)]" /> : block.result === "insufficient_data" ? <Minus className="size-3.5" /> : <TriangleAlert className="size-3.5 text-[var(--clara-amber)]" />} Conferência</p><p className="mt-3 text-sm">{block.explanation}</p><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><span>Declarado<br /><strong>{block.declaredAmount === null ? "—" : formatCents(block.declaredAmount)}</strong></span><span>Calculado<br /><strong>{block.calculatedAmount === null ? "—" : formatCents(block.calculatedAmount)}</strong></span></div></section>;
}

function ArtifactRow({ label, amount, detail, share, ids }: { label: string; amount: number; detail?: string; share?: number; ids: string[] }) {
  return <li className="border-b border-[var(--clara-fog)] py-4 last:border-0"><div className="flex items-baseline justify-between gap-4"><span className="min-w-0"><strong className="block truncate">{label}</strong>{detail ? <small className="clara-small mt-1 block">{detail}</small> : null}</span><span className="shrink-0 tabular-nums">{formatCents(amount)}</span></div>{share !== undefined ? <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--clara-fog)]"><div className="h-full rounded-full bg-[var(--clara-blue)]" style={{ width: `${Math.round(share * 100)}%` }} /></div> : null}<Trace ids={ids} /></li>;
}

function Trace({ ids }: { ids: readonly string[] }) {
  const [open, setOpen] = useState(false);
  if (ids.length === 0) return null;
  return <><button type="button" className="clara-link mt-1 text-xs" onClick={() => setOpen((value) => !value)}>{open ? "Ocultar origem" : `Ver ${ids.length === 1 ? "o lançamento" : `os ${ids.length} lançamentos`}`}</button>{open ? <Provenance ids={ids} /> : null}</>;
}
