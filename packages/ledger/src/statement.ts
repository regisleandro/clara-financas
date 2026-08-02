import type { Transaction } from "./types";

export type StatementBalanceReport = {
  kind: "statement_balance";
  result: "match" | "mismatch" | "insufficient_data";
  openingBalance: number | null;
  closingBalance: number | null;
  netMovement: number;
  expectedClosingBalance: number | null;
  difference: number | null;
};

/**
 * Extratos têm uma prova diferente de faturas: saldo inicial menos as
 * movimentações deve chegar ao saldo final. Valores de saída são positivos e
 * entradas negativas, a mesma convenção do razão.
 */
export function verifyStatementBalance(
  transactions: Transaction[],
  openingBalance: number | null,
  closingBalance: number | null,
): StatementBalanceReport {
  const netMovement = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  if (openingBalance === null || closingBalance === null) {
    return {
      kind: "statement_balance",
      result: "insufficient_data",
      openingBalance,
      closingBalance,
      netMovement,
      expectedClosingBalance: null,
      difference: null,
    };
  }

  const expectedClosingBalance = openingBalance - netMovement;
  const difference = expectedClosingBalance - closingBalance;
  return {
    kind: "statement_balance",
    result: difference === 0 ? "match" : "mismatch",
    openingBalance,
    closingBalance,
    netMovement,
    expectedClosingBalance,
    difference,
  };
}
