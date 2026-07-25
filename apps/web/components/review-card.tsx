"use client";

import { useState } from "react";

/**
 * Cartão de Conferência.
 *
 * É a materialização do gate: quando `commit_batch` pede aprovação, o eve
 * estaciona o turno e emite `input.requested`. O pedido chega numa parte
 * `dynamic-tool` da última mensagem, em `part.toolMetadata.eve.inputRequest`.
 * Em vez de renderizar um "aprovar/negar" genérico, olhamos o nome da tool e
 * mostramos o que a pessoa precisa para decidir.
 *
 * A pergunta que o cartão responde é "posso confiar nisto?", e a resposta é o
 * checksum: o documento declara o próprio total, e a soma do que extraímos ou
 * bate com ele, ou não.
 */

export type ChecksumReport = {
  result: "match" | "mismatch" | "no_declared_total";
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

export type ReviewCardData = {
  batchId: string;
  transactionCount: number;
  issuer?: string | null;
  checksum: ChecksumReport;
};

const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function ReviewCard({
  data,
  disabled,
  onApprove,
  onReject,
}: {
  data: ReviewCardData;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [answered, setAnswered] = useState(false);
  const { checksum } = data;
  const busy = disabled || answered;

  return (
    <section className="rounded-2xl border bg-card p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">
            CONFERÊNCIA
          </p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight">
            {data.transactionCount} transações propostas
          </h3>
          {data.issuer ? (
            <p className="mt-1 text-sm text-muted-foreground">{data.issuer}</p>
          ) : null}
        </div>
        <ChecksumBadge report={checksum} />
      </header>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">Total da fatura</dt>
          <dd className="mt-1 text-lg font-medium tabular-nums">
            {checksum.declaredTotal === null ? "não declarado" : brl(checksum.declaredTotal)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Total extraído</dt>
          <dd className="mt-1 text-lg font-medium tabular-nums">
            {brl(checksum.extractedTotal)}
          </dd>
        </div>
      </dl>

      {checksum.result === "mismatch" && checksum.difference !== null ? (
        <p className="mt-4 rounded-lg bg-[var(--clara-amber-bg)] px-4 py-3 text-sm text-[var(--clara-amber)]">
          Diferença de <strong className="tabular-nums">{brl(Math.abs(checksum.difference))}</strong>{" "}
          {checksum.difference > 0 ? "a mais" : "a menos"} do que a fatura declara.
        </p>
      ) : null}

      {checksum.result === "no_declared_total" ? (
        <p className="mt-4 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
          Este documento não declara um total, então não há como conferir a soma
          automaticamente. Vale uma olhada nos itens antes de aprovar.
        </p>
      ) : null}

      {checksum.suspectItems.length > 0 ? (
        <div className="mt-6">
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">
            ONDE OLHAR PRIMEIRO
          </p>
          <ul className="mt-3 space-y-2">
            {checksum.suspectItems.slice(0, 5).map((item) => (
              <li
                key={item.transactionId}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 text-sm last:border-0"
              >
                <span className="text-muted-foreground">
                  {item.reason}
                  {item.page !== null ? ` · página ${item.page}` : ""}
                </span>
                <span className="tabular-nums">{brl(item.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <footer className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setAnswered(true);
            onApprove();
          }}
          className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Aprovar e registrar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setAnswered(true);
            onReject();
          }}
          className="inline-flex h-11 items-center justify-center rounded-full px-6 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
        >
          Rejeitar lote
        </button>
        <p className="w-full text-xs text-muted-foreground">
          Para corrigir um item, diga o que está errado na conversa — a Clara ajusta e
          reconfere antes de registrar.
        </p>
      </footer>
    </section>
  );
}

function ChecksumBadge({ report }: { report: ChecksumReport }) {
  if (report.result === "match") {
    return (
      <span className="rounded-full bg-[var(--clara-green-bg)] px-3 py-1.5 text-sm font-medium text-[var(--clara-green)]">
        Total confere
      </span>
    );
  }
  if (report.result === "mismatch") {
    return (
      <span className="rounded-full bg-[var(--clara-amber-bg)] px-3 py-1.5 text-sm font-medium text-[var(--clara-amber)]">
        Divergência
      </span>
    );
  }
  return (
    <span className="rounded-full bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground">
      Sem total declarado
    </span>
  );
}
