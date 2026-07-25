"use client";

import { useState } from "react";

/**
 * Card de gastos do mês.
 *
 * O botão "Ocultar" existe porque este número é o mais sensível da tela — a
 * pessoa pode estar num café, num call compartilhando a tela. Esconder é
 * client-side e imediato; nada some do servidor.
 */
export function SpendCard({
  periodLabel,
  totalFormatted,
  comparison,
  spark,
  rangeLabels,
}: {
  periodLabel: string;
  totalFormatted: string;
  comparison: { deltaPercent: number; previousLabel: string } | null;
  spark: number[];
  rangeLabels: { from: string; to: string };
}) {
  const [hidden, setHidden] = useState(false);

  return (
    <article className="clara-card flex flex-col p-7">
      <div className="flex items-center justify-between">
        <span className="clara-chip">{periodLabel}</span>
        <button
          type="button"
          onClick={() => setHidden((value) => !value)}
          className="clara-chip text-[var(--clara-link)]"
        >
          {hidden ? "Mostrar" : "Ocultar"}
        </button>
      </div>

      <p className="mt-8 text-[var(--clara-graphite)]">Gastos no mês</p>
      <p className="clara-metric mt-1.5">{hidden ? "R$ ••••••" : totalFormatted}</p>

      {comparison !== null ? (
        <p className="mt-2.5 text-[var(--clara-graphite)]">
          <span className="font-semibold text-[var(--clara-ink)]">
            {comparison.deltaPercent > 0 ? "↑" : "↓"}{" "}
            {Math.abs(comparison.deltaPercent).toLocaleString("pt-BR")}%
          </span>{" "}
          em relação a {comparison.previousLabel}
        </p>
      ) : (
        <p className="mt-2.5 text-[var(--clara-graphite)]">
          Sem período anterior para comparar ainda.
        </p>
      )}

      {spark.length > 0 ? (
        <>
          <div className="mt-10 flex h-[120px] items-end gap-1.5" aria-hidden="true">
            {spark.map((height, index) => (
              <i
                key={index}
                className="block flex-1 rounded-full bg-[var(--clara-ash)]"
                style={{ height: `${Math.max(4, height)}%` }}
              />
            ))}
          </div>
          <div className="clara-small mt-3 flex justify-between">
            <span>{rangeLabels.from}</span>
            <span>{rangeLabels.to}</span>
          </div>
        </>
      ) : null}
    </article>
  );
}
