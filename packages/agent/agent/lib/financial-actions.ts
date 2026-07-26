export type InvoiceResolutionPlan = {
  differenceBeforeCents: number;
  adjustmentCents: number;
  differenceAfterExpectedCents: 0;
};

/**
 * Invariante contábil usada tanto na preparação quanto na execução.
 *
 * A diferença do checksum é `extraído - declarado`; o delta que fecha a conta
 * é necessariamente o inverso. Manter isso fora do modelo e fora da UI evita
 * que cada camada reinvente o sinal.
 */
export function invoiceResolutionPlan(
  differenceCents: number | null,
): InvoiceResolutionPlan | null {
  if (differenceCents === null || differenceCents === 0 || !Number.isInteger(differenceCents)) {
    return null;
  }
  return {
    differenceBeforeCents: differenceCents,
    adjustmentCents: -differenceCents,
    differenceAfterExpectedCents: 0,
  };
}

export function sameRevision(current: Date, expected: Date): boolean {
  return current.getTime() === expected.getTime();
}
