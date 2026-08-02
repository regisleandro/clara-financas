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

export function scopeFilter(scope: AnalysisScope): LedgerScopeFilter {
  switch (scope.kind) {
    case "calendar_month": {
      const dates = monthRange(scope.month);
      return { ...dates, issuer: scope.issuer };
    }
    case "invoice":
      return { batchId: scope.batchId };
    case "range":
      return { from: scope.from, to: scope.to, issuer: scope.issuer };
    case "all":
      return { issuer: scope.issuer };
  }
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
