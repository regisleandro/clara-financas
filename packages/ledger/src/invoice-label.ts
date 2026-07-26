const SHORT_DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  timeZone: "UTC",
});

/**
 * Nome financeiro estável para uma fatura.
 *
 * O vencimento é a data que a pessoa reconhece primeiro; na falta dele, usamos
 * o fim do ciclo. O nome físico do PDF nunca participa do rótulo.
 */
export function formatInvoiceLabel({
  issuer,
  dueDate,
  periodEnd,
}: {
  issuer?: string | null;
  dueDate?: string | null;
  periodEnd?: string | null;
}): string {
  const origin = issuer?.trim() || "Fatura";
  const date = dueDate ?? periodEnd;
  if (date === null || date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return origin;
  }
  return `${origin} ${SHORT_DATE.format(new Date(`${date}T12:00:00Z`))}`;
}
