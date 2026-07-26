"use client";

import { useState, useTransition } from "react";
import { formatCents } from "@clara-financas/ledger";

import { nameDocumentIssuer, reopenReview, reviewTransaction } from "@/app/(app)/revisar/actions";
import {
  REASON_LABEL,
  type ActionResult,
  type ReviewItem,
  type ReviewQueue,
  type ReviewReason,
} from "@/lib/review-types";

/**
 * A fila de revisão manual.
 *
 * Quatro decisões que definem esta tela:
 *
 *  1. **A descrição CRUA fica visível, sempre.** É o texto que está na fatura,
 *     e é contra ele que a pessoa confere. Escondê-lo atrás de um clique
 *     transformaria a revisão em adivinhação sobre o palpite da Clara.
 *
 *  2. **"Está certo" é um botão de primeira classe.** A conclusão mais comum de
 *     uma revisão é que não há nada a mudar, e se essa conclusão desse mais
 *     trabalho que corrigir, a fila nunca esvaziaria.
 *
 *  3. **Nada de salvar automático.** A revisão é uma decisão, e decisão que
 *     acontece por foco perdido não é decisão.
 *
 *  4. **O erro fica no item.** Um toast global obrigaria a pessoa a lembrar
 *     qual das vinte linhas falhou.
 *
 *  5. **O que acabou de sair da fila continua alcançável.** Um clique errado em
 *     "leu certo" sumiria com a linha sem volta — a tela só mostra o que está
 *     pendente. A faixa de concluídos guarda o item em estado local para que
 *     desfazer não dependa de a pessoa lembrar qual era.
 */

const fullDate = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));

type Draft = { merchant: string; category: string; reason: string };

export function ReviewQueue({ queue }: { queue: ReviewQueue }) {
  const [filter, setFilter] = useState<ReviewReason | "todos">("todos");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<ReviewItem[]>([]);
  const [, startTransition] = useTransition();

  const visible =
    filter === "todos"
      ? queue.items
      : queue.items.filter((item) => item.reasons.includes(filter));

  function run(key: string, action: () => Promise<ActionResult>, onDone?: () => void) {
    setBusy(key);
    setErrors((current) => {
      const rest = { ...current };
      delete rest[key];
      return rest;
    });

    startTransition(async () => {
      const result = await action();
      setBusy(null);
      if (result.ok) onDone?.();
      else setErrors((current) => ({ ...current, [key]: result.error }));
    });
  }

  const filters: Array<{ key: ReviewReason | "todos"; label: string; count: number }> = [
    { key: "todos", label: "Tudo", count: queue.items.length },
    ...(Object.keys(REASON_LABEL) as ReviewReason[]).map((reason) => ({
      key: reason,
      label: REASON_LABEL[reason],
      count: queue.counts[reason],
    })),
  ];

  return (
    <>
      {queue.divergentBatches.length > 0 ? (
        <section className="mb-6">
          <div
            className="clara-card px-7 py-6"
            style={{ background: "var(--clara-amber-bg)" }}
          >
            <strong className="block font-semibold">
              {queue.divergentBatches.length === 1
                ? "Uma fatura fechou com a soma divergente"
                : `${queue.divergentBatches.length} faturas fecharam com a soma divergente`}
            </strong>
            <p className="clara-small mt-1.5" style={{ color: "var(--clara-amber)" }}>
              Valor confirmado não se edita — a correção é uma linha de ajuste, e ela passa
              pela conversa.
            </p>
            <ul className="mt-4">
              {queue.divergentBatches.map((batch) => (
                <li
                  key={batch.id}
                  className="flex flex-wrap items-baseline justify-between gap-3 border-t border-black/10 py-3"
                >
                  <span className="min-w-0">
                    <strong className="block truncate font-normal">
                      {batch.issuer ?? batch.filename}
                    </strong>
                    <small className="clara-small">
                      {batch.periodLabel ?? "período não declarado"}
                    </small>
                  </span>
                  <span className="tabular-nums">
                    {batch.difference === null
                      ? "diferença não calculada"
                      : `${batch.difference > 0 ? "+" : ""}${formatCents(batch.difference)}`}
                  </span>
                </li>
              ))}
            </ul>
            <a href="/conversa" className="clara-link mt-4 inline-block">
              Resolver na conversa ›
            </a>
          </div>
        </section>
      ) : null}

      {queue.unnamedDocuments.length > 0 ? (
        <UnnamedDocuments
          documents={queue.unnamedDocuments}
          busy={busy}
          errors={errors}
          onSubmit={(document, issuer) =>
            run(`doc:${document}`, () => nameDocumentIssuer({ documentId: document, issuer }))
          }
        />
      ) : null}

      {done.length > 0 ? (
        <section
          aria-live="polite"
          className="clara-card mb-6 px-7 py-6"
          style={{ background: "var(--clara-green-bg)" }}
        >
          <strong className="block font-semibold">
            {done.length} {done.length === 1 ? "concluído" : "concluídos"} agora
          </strong>
          <ul className="mt-3">
            {done.map((item) => {
              const key = `undo:${item.id}`;
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-black/10 py-3"
                >
                  <span className="min-w-0 flex-1 truncate">{item.originalDescription}</span>
                  <span className="tabular-nums">{formatCents(item.amount)}</span>
                  <button
                    type="button"
                    onClick={() =>
                      run(key, () => reopenReview({ transactionId: item.id }), () =>
                        setDone((current) => current.filter((entry) => entry.id !== item.id)),
                      )
                    }
                    disabled={busy === key}
                    className="clara-link disabled:opacity-50"
                  >
                    {busy === key ? "Desfazendo…" : "Desfazer"}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="clara-small mt-3" style={{ color: "var(--clara-green)" }}>
            Desfazer devolve o item à fila. As mudanças de categoria e comerciante já feitas
            continuam na trilha de auditoria — trilha não se apaga.
          </p>
        </section>
      ) : null}

      <nav aria-label="Filtro da fila" className="mb-6 flex flex-wrap gap-2">
        {filters.map((entry) => {
          const active = filter === entry.key;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => setFilter(entry.key)}
              aria-pressed={active}
              className="rounded-full px-[15px] py-2 text-xs transition-colors"
              style={{
                letterSpacing: "-0.022em",
                background: active ? "var(--clara-ink)" : "var(--clara-white)",
                color: active ? "var(--clara-white)" : "var(--clara-ink)",
              }}
            >
              {entry.label} · {entry.count}
            </button>
          );
        })}
      </nav>

      {visible.length === 0 ? (
        <div className="clara-card p-[52px] text-center">
          <p className="clara-display-sm">
            {queue.items.length === 0
              ? "Nada esperando por você."
              : "Nada por aqui com esse filtro."}
          </p>
          {queue.items.length === 0 && queue.reviewedCount > 0 ? (
            <p className="clara-small mt-3">
              {queue.reviewedCount}{" "}
              {queue.reviewedCount === 1 ? "lançamento revisado" : "lançamentos revisados"} até
              agora.
            </p>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3">
          {visible.map((item) => {
            const draft = drafts[item.id] ?? {
              merchant: item.merchant ?? "",
              category: item.category ?? "",
              reason: "",
            };
            const key = `tx:${item.id}`;
            const isBusy = busy === key;

            const remember = () => setDone((current) => [item, ...current]);

            const save = () =>
              run(
                key,
                () =>
                  reviewTransaction({
                    transactionId: item.id,
                    category: draft.category === "" ? null : draft.category,
                    merchant: draft.merchant === "" ? null : draft.merchant,
                    reason: draft.reason === "" ? null : draft.reason,
                  }),
                remember,
              );

            return (
              <li key={item.id} className="clara-card p-7">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2.5 flex flex-wrap gap-1.5">
                      {item.reasons.map((reason) => (
                        <i key={reason} className="clara-chip not-italic">
                          {REASON_LABEL[reason]}
                        </i>
                      ))}
                    </div>
                    {/* A descrição como está no documento — o texto contra o
                        qual a pessoa confere. Não é resumo nem palpite. */}
                    <strong className="block break-words font-semibold">
                      {item.originalDescription}
                    </strong>
                    <small className="clara-small mt-[3px] block">
                      {fullDate(item.date)} · {item.issuer ?? "operadora não identificada"}
                      {item.filename === null ? "" : ` · ${item.filename}`}
                      {item.page === null ? "" : ` · página ${item.page}`}
                    </small>
                  </div>
                  <span className="clara-display-xs shrink-0 tabular-nums">
                    {formatCents(item.amount)}
                  </span>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="clara-small mb-1.5 block">Comerciante</span>
                    <input
                      value={draft.merchant}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [item.id]: { ...draft, merchant: event.target.value },
                        }))
                      }
                      placeholder="Quem recebeu o dinheiro"
                      className="w-full rounded-[var(--clara-radius-pill)] bg-[var(--clara-fog)] px-5 py-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--clara-blue)]"
                    />
                  </label>

                  <label className="block">
                    <span className="clara-small mb-1.5 block">Categoria</span>
                    <select
                      value={draft.category}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [item.id]: { ...draft, category: event.target.value },
                        }))
                      }
                      className="w-full appearance-none rounded-[var(--clara-radius-pill)] bg-[var(--clara-fog)] px-5 py-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--clara-blue)]"
                    >
                      <option value="">Sem categoria</option>
                      {queue.categories.map((category) => (
                        <option key={category.slug} value={category.slug}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block sm:col-span-2">
                    <span className="clara-small mb-1.5 block">Por quê (opcional)</span>
                    <input
                      value={draft.reason}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [item.id]: { ...draft, reason: event.target.value },
                        }))
                      }
                      placeholder="Fica na trilha de auditoria com o seu nome"
                      className="w-full rounded-[var(--clara-radius-pill)] bg-[var(--clara-fog)] px-5 py-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--clara-blue)]"
                    />
                  </label>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={save}
                    disabled={isBusy}
                    className="clara-pill clara-pill-primary disabled:opacity-50"
                  >
                    {isBusy ? "Salvando…" : "Salvar e concluir"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      run(
                        key,
                        () =>
                          reviewTransaction({
                            transactionId: item.id,
                            category: item.category,
                            merchant: item.merchant,
                            reason: null,
                          }),
                        remember,
                      )
                    }
                    disabled={isBusy}
                    className="clara-pill clara-pill-outline disabled:opacity-50"
                  >
                    A Clara leu certo
                  </button>
                  {errors[key] === undefined ? null : (
                    <span role="alert" className="text-xs text-[var(--clara-ink)]">
                      {errors[key]}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * Documentos cuja operadora o extrator não identificou.
 *
 * Fica acima da fila de lançamentos porque uma escrita aqui conserta a fatura
 * inteira na visão por operadora — enquanto o campo está vazio, todas as linhas
 * daquele documento caem em "Sem operadora".
 */
function UnnamedDocuments({
  documents,
  busy,
  errors,
  onSubmit,
}: {
  documents: ReviewQueue["unnamedDocuments"];
  busy: string | null;
  errors: Record<string, string>;
  onSubmit: (documentId: string, issuer: string) => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});

  return (
    <section className="clara-card mb-6 px-7 py-6">
      <strong className="block font-semibold">
        {documents.length === 1
          ? "Um documento está sem operadora"
          : `${documents.length} documentos estão sem operadora`}
      </strong>
      <p className="clara-small mt-1.5">
        Sem esse nome, os lançamentos ficam em “Sem operadora” na visão por operadora e mês.
      </p>

      <ul className="mt-4">
        {documents.map((document) => {
          const key = `doc:${document.id}`;
          const value = names[document.id] ?? "";
          return (
            <li key={document.id} className="border-t border-[var(--clara-fog)] py-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1">
                  <strong className="block truncate font-normal">{document.filename}</strong>
                  <small className="clara-small">
                    {document.entryCount}{" "}
                    {document.entryCount === 1 ? "lançamento" : "lançamentos"}
                  </small>
                </span>
                <input
                  value={value}
                  onChange={(event) =>
                    setNames((current) => ({ ...current, [document.id]: event.target.value }))
                  }
                  placeholder="Nubank, Itaú…"
                  aria-label={`Operadora de ${document.filename}`}
                  className="w-full rounded-[var(--clara-radius-pill)] bg-[var(--clara-fog)] px-5 py-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--clara-blue)] sm:w-[220px]"
                />
                <button
                  type="button"
                  onClick={() => onSubmit(document.id, value)}
                  disabled={busy === key || value.trim() === ""}
                  className="clara-pill clara-pill-outline disabled:opacity-50"
                >
                  {busy === key ? "Salvando…" : "Nomear"}
                </button>
              </div>
              {errors[key] === undefined ? null : (
                <span role="alert" className="clara-small mt-2 block">
                  {errors[key]}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
