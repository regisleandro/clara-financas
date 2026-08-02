import type {
  AnalysisRequestScope,
  AnalysisScope,
  ComparableAnalysisScope,
} from "@clara-financas/views/agent-contracts";

import { monthRange } from "./dates";

export type LedgerScopeFilter = {
  from?: string;
  to?: string;
  issuer?: string;
  batchId?: string;
  includeProposed?: boolean;
};

/**
 * Converte um intervalo que cobre exatamente um mês civil para a forma
 * canônica `calendar_month`.
 *
 * Modelos diferentes expressam "janeiro" ora como mês, ora como
 * 01/01–31/01. As duas consultas atingem as mesmas linhas, mas não têm a
 * mesma semântica para rótulos, comparações e auditoria. Essa equivalência é
 * calendário, não julgamento: fica no código e deixa de depender do modelo.
 */
export function canonicalAnalysisScope(scope: ComparableAnalysisScope): ComparableAnalysisScope;
export function canonicalAnalysisScope(scope: AnalysisScope): AnalysisScope;
export function canonicalAnalysisScope(scope: AnalysisScope): AnalysisScope {
  if (scope.kind !== "range" || !scope.from.endsWith("-01")) return scope;

  const month = scope.from.slice(0, 7);
  const dates = monthRange(month);
  if (scope.from !== dates.from || scope.to !== dates.to) return scope;

  return {
    kind: "calendar_month",
    month,
    ...(scope.issuer === undefined ? {} : { issuer: scope.issuer }),
  };
}

export function canonicalAnalysisRequestScope(scope: AnalysisRequestScope): AnalysisRequestScope {
  if (scope.kind !== "comparison") return canonicalAnalysisScope(scope);
  return {
    kind: "comparison",
    current: canonicalAnalysisScope(scope.current),
    previous: canonicalAnalysisScope(scope.previous),
  };
}

/**
 * O recorte, e com ele a decisão sobre RASCUNHO — uma vez só.
 *
 * `includeProposed` vivia em cada tool, e só `query_ledger` o ligava. O
 * resultado era uma contradição dentro do mesmo turno: "mostre os lançamentos
 * desta fatura" listava tudo, e "quanto gastei nesta fatura" respondia que o
 * recorte não possui lançamentos. As duas frases sobre o mesmo documento, uma
 * depois da outra.
 *
 * A regra correta não é "incluir rascunho em tudo" nem "em nada" — é que
 * `invoice` é um recorte sobre o DOCUMENTO, não sobre o razão. Perguntar de uma
 * fatura em conferência é perguntar do papel que está na mesa, e o rascunho é
 * exatamente o que está lá. Já `calendar_month`, `range` e `all` são recortes do
 * razão: ali o rascunho viraria fato, e continua de fora.
 *
 * Quem inclui rascunho precisa DIZER (ver `draftNote`). Apresentar como
 * registrado o que ainda espera aprovação é o erro que a exclusão original
 * tentava evitar, e ele não some por a leitura ser conveniente.
 */
export function scopeFilter(scope: AnalysisScope): LedgerScopeFilter {
  switch (scope.kind) {
    case "calendar_month": {
      const dates = monthRange(scope.month);
      return { ...dates, issuer: scope.issuer };
    }
    case "invoice":
      return { batchId: scope.batchId, includeProposed: true };
    case "range":
      return { from: scope.from, to: scope.to, issuer: scope.issuer };
    case "all":
      return { issuer: scope.issuer };
  }
}

/**
 * O aviso que acompanha todo painel montado sobre rascunho.
 *
 * Uma frase, no resumo do painel — não um `warning` que a interface pode
 * engolir. O número está certo; o que a pessoa precisa saber é que ele ainda
 * não é fato.
 */
export function draftNote(entries: readonly { status: string }[]): string {
  const drafts = entries.filter((entry) => entry.status === "proposed").length;
  if (drafts === 0) return "";
  return drafts === entries.length
    ? " Esta fatura ainda está em conferência: nada aqui foi registrado no razão."
    : ` ${drafts} ${drafts === 1 ? "lançamento ainda está" : "lançamentos ainda estão"} em conferência.`;
}

export function scopeLabel(scope: AnalysisScope): string {
  switch (scope.kind) {
    case "calendar_month":
      return `${scope.month}${scope.issuer === undefined ? "" : ` · ${scope.issuer}`}`;
    case "invoice":
      return `Fatura ${scope.batchId}`;
    case "range":
      return `${scope.from} a ${scope.to}${scope.issuer === undefined ? "" : ` · ${scope.issuer}`}`;
    case "all":
      return scope.issuer === undefined ? "Todo o razão" : `Todo o razão · ${scope.issuer}`;
  }
}
