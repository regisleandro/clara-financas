"use client";

import { useState } from "react";

import type { LedgerRow } from "@/lib/ledger";

/**
 * Composição por categoria, expansível até a origem.
 *
 * É a prova visual da hipótese H5: um clique abre as transações que somam o
 * número, e cada linha mostra o documento e a página de onde veio. Nenhum
 * valor aqui é recalculado no cliente — os totais vêm das mesmas funções que
 * o analista usa, e os ids de cada categoria são o que liga um ao outro.
 */

type CategorySummary = {
  category: string | null;
  value: number;
  count: number;
  share: number;
  transactionIds: string[];
};

const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

const CONFIDENCE_LABEL: Record<string, string> = {
  alta: "",
  media: "confiança média",
  baixa: "confiança baixa",
};

export function CategoryBreakdown({
  categories,
  rows,
}: {
  categories: CategorySummary[];
  rows: LedgerRow[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const byId = new Map(rows.map((row) => [row.id, row]));

  return (
    <section className="mt-10">
      <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">
        COMPOSIÇÃO
      </p>

      <ul className="mt-4">
        {categories.map((bucket) => {
          const key = bucket.category ?? "__none__";
          const isOpen = expanded === key;
          const label = bucket.category ?? "sem categoria";

          return (
            <li key={key} className="border-b last:border-0">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : key)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-4 py-4 text-left transition-colors hover:bg-secondary/50"
              >
                <span className="w-4 shrink-0 text-muted-foreground" aria-hidden="true">
                  {isOpen ? "−" : "+"}
                </span>
                <span className={bucket.category === null ? "text-muted-foreground italic" : ""}>
                  {label}
                </span>
                <span className="text-sm text-muted-foreground">{bucket.count}</span>
                <span className="ml-auto tabular-nums">{brl(bucket.value)}</span>
                <span className="w-14 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                  {(bucket.share * 100).toFixed(1)}%
                </span>
              </button>

              {isOpen ? (
                <div className="pb-6 pl-8">
                  <p className="mb-3 text-xs text-muted-foreground">
                    {bucket.transactionIds.length} transações somam {brl(bucket.value)}
                  </p>
                  <ul className="space-y-3">
                    {bucket.transactionIds.map((id) => {
                      const row = byId.get(id);
                      if (row === undefined) return null;
                      const confidence = CONFIDENCE_LABEL[row.extractionConfidence] ?? "";

                      return (
                        <li key={id} className="text-sm">
                          <div className="flex flex-wrap items-baseline gap-x-3">
                            <span className="tabular-nums text-muted-foreground">{row.date}</span>
                            <span>{row.merchant ?? row.originalDescription}</span>
                            {row.installment ? (
                              <span className="text-muted-foreground">
                                {row.installment.current}/{row.installment.total}
                              </span>
                            ) : null}
                            <span className="ml-auto tabular-nums">{brl(row.amount)}</span>
                          </div>
                          {/* A proveniência: de onde este número veio. */}
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {row.documentIssuer ?? row.documentFilename ?? "documento"}
                            {row.page !== null ? ` · página ${row.page}` : ""}
                            {confidence !== "" ? ` · ${confidence}` : ""}
                            {row.status === "adjustment" ? " · linha de ajuste" : ""}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
