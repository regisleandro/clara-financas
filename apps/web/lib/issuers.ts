import "server-only";

import { loadCategoryLabels } from "@clara-financas/db/category-labels";
import {
  aggregateByIssuerMonth,
  categoryLabel,
  formatMonthLabel,
  issuerKey,
  UNKNOWN_ISSUER,
} from "@clara-financas/ledger";

import { loadLedgerView, type LedgerRow } from "@/lib/ledger";

/**
 * O razão cruzado por operadora e mês.
 *
 * A agregação em si é pura e vive em `@clara-financas/ledger` — a mesma que o
 * analista chama na conversa. Aqui só se traduz para o que a tela precisa:
 * rótulos em português, valores formatados e os grupos já montados.
 *
 * Os grupos NÃO são uma segunda passada sobre as transações: eles são montados
 * a partir dos `transactionIds` que cada célula da matriz carrega. É o que
 * garante que a lista embaixo de "Nubank · junho" contenha exatamente os
 * lançamentos que somam o número mostrado na célula — e não linhas obtidas por
 * um filtro parecido, que é onde tela e total começam a divergir.
 */

// A identidade da operadora vive em `@clara-financas/ledger` — o filtro por
// operadora do analista usa a MESMA chave, então tela e conversa concordam
// sobre o que agrupa com o quê.
export { issuerKey, UNKNOWN_ISSUER };

export type IssuerMonthCell = { value: number; count: number } | null;

export type IssuerGroupRow = {
  id: string;
  merchant: string;
  date: string;
  categoryLabel: string;
  confidence: "alta" | "media" | "baixa";
  amount: number;
  page: number | null;
  filename: string | null;
  isAdjustment: boolean;
};

export type IssuerMonthView = {
  months: Array<{ key: string; label: string }>;
  issuers: Array<{
    key: string;
    label: string;
    total: number;
    count: number;
    /** Uma posição por mês de `months`, na mesma ordem. */
    byMonth: IssuerMonthCell[];
  }>;
  /** Total de cada mês de `months`, na mesma ordem. */
  monthTotals: number[];
  total: number;
  /** Um grupo por par (operadora, mês) que tenha lançamento. */
  groups: Array<{
    key: string;
    issuerKey: string;
    issuerLabel: string;
    monthLabel: string;
    total: number;
    rows: IssuerGroupRow[];
  }>;
};

// O nome longo do mês vem do domínio (`formatMonthLabel`), não de um Intl
// local: a conversa nomeia os MESMOS meses desta tela, e duas formatações
// independentes divergiriam na primeira diferença de locale.
const monthLabel = formatMonthLabel;

const shortMonthLabel = (yearMonth: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(
    new Date(`${yearMonth}-01T12:00:00Z`),
  );

export async function loadIssuerMonthView(tenantId: string): Promise<IssuerMonthView> {
  const [{ rows }, labels] = await Promise.all([
    loadLedgerView(tenantId),
    loadCategoryLabels(tenantId),
  ]);

  const matrix = aggregateByIssuerMonth(
    rows.map((row) => ({ ...row, issuer: row.documentIssuer })),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));

  const groups: IssuerMonthView["groups"] = [];

  for (const issuer of matrix.issuers) {
    const key = issuerKey(issuer.issuer);
    const label = issuer.issuer ?? "Sem operadora";

    issuer.byMonth.forEach((cell, position) => {
      if (cell === null) return;
      const month = matrix.months[position]!;

      groups.push({
        key: `${key}:${month}`,
        issuerKey: key,
        issuerLabel: label,
        monthLabel: capitalize(monthLabel(month)),
        total: cell.value,
        // A ordem vem dos ids da célula, reordenados por data decrescente —
        // igual ao resto do razão.
        rows: cell.transactionIds
          .map((id) => byId.get(id))
          .filter((row): row is LedgerRow => row !== undefined)
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((row) => ({
            id: row.id,
            merchant: row.merchant ?? row.originalDescription,
            date: row.date,
            categoryLabel: categoryLabel(labels, row.category),
            confidence: row.extractionConfidence,
            amount: row.amount,
            page: row.page,
            filename: row.documentFilename,
            isAdjustment: row.status === "adjustment",
          })),
      });
    });
  }

  return {
    months: matrix.months.map((month) => ({
      key: month,
      label: capitalize(shortMonthLabel(month).replace(".", "")),
    })),
    issuers: matrix.issuers.map((issuer) => ({
      key: issuerKey(issuer.issuer),
      label: issuer.issuer ?? "Sem operadora",
      total: issuer.total.value,
      count: issuer.total.count,
      byMonth: issuer.byMonth.map((cell) =>
        cell === null ? null : { value: cell.value, count: cell.count },
      ),
    })),
    monthTotals: matrix.monthTotals.map((month) => month.value),
    total: matrix.total.value,
    groups,
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
