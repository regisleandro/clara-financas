"use client";

import { formatCents } from "@clara-financas/ledger";
import { useEffect, useState } from "react";

/**
 * De onde vem este número.
 *
 * A lista é buscada do banco pelos ids que a própria linha carrega — sem
 * modelo no caminho. Perguntar à Clara "quais lançamentos formam esses
 * R$ 1.240,00" gastaria um turno para reconstituir o que os ids já dizem, e
 * poderia responder outra coisa. Aqui a resposta é a mesma sempre.
 *
 * A descrição mostrada é a CRUA do documento: é contra ela que se confere, e
 * trocá-la pelo palpite do extrator transformaria a conferência em confiança.
 */

type Entry = {
  id: string;
  date: string;
  description: string;
  merchant: string | null;
  amountCents: number;
  issuer: string | null;
};

type State =
  | { status: "loading" }
  | { status: "ready"; entries: Entry[]; requested: number }
  | { status: "error" };

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );

export function Provenance({ ids }: { ids: readonly string[] }) {
  const [state, setState] = useState<State>({ status: "loading" });
  // A dependência é o CONTEÚDO da lista, não a sua identidade: o painel
  // remonta o array a cada render e um `ids` como dependência refaria a busca
  // para sempre.
  const key = JSON.stringify({ ids: [...ids] });

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });

    fetch("/api/transactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: key,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("falhou");
        return (await response.json()) as { entries: Entry[]; requested: number };
      })
      .then((data) => {
        if (alive) setState({ status: "ready", entries: data.entries, requested: data.requested });
      })
      .catch(() => {
        // Falhar aqui não pode derrubar o painel: o número continua válido, o
        // que se perde é o detalhamento.
        if (alive) setState({ status: "error" });
      });

    return () => {
      alive = false;
    };
  }, [key]);

  if (state.status === "loading") {
    return <p className="clara-small mt-3">Buscando os lançamentos…</p>;
  }
  if (state.status === "error") {
    return <p className="clara-small mt-3">Não consegui abrir os lançamentos agora.</p>;
  }

  if (state.entries.length === 0) {
    return <p className="clara-small mt-3">Esses lançamentos não estão mais no razão.</p>;
  }

  return (
    <div className="mt-3 rounded-[var(--clara-radius-tile)] bg-[var(--clara-fog)] p-4">
      <ul className="space-y-2.5">
        {state.entries.map((entry) => (
          <li key={entry.id} className="grid grid-cols-[1fr_auto] items-baseline gap-3">
            <span className="min-w-0">
              <span className="block truncate text-sm">{entry.description}</span>
              <small className="clara-small">
                {dayLabel(entry.date)}
                {entry.issuer !== null ? ` · ${entry.issuer}` : ""}
              </small>
            </span>
            <span className="text-sm tabular-nums">{formatCents(entry.amountCents)}</span>
          </li>
        ))}
      </ul>

      {/* Pedir 12 e receber 9 significa que algo saiu do razão — um lote
          descartado, por exemplo. Mostrar a lista curta sem dizer nada faria
          a soma parecer errada. */}
      {state.requested > state.entries.length ? (
        <p className="clara-small mt-3">
          {state.requested - state.entries.length} de {state.requested} não estão mais no razão.
        </p>
      ) : null}
    </div>
  );
}
