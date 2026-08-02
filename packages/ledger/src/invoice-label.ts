const SHORT_DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  timeZone: "UTC",
});

export type FinancialDocumentKind =
  | "unknown"
  | "credit_card_invoice"
  | "bank_statement"
  | "invoice_nfe";

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

/** Nome estável para qualquer documento, sem chamar extrato de fatura. */
export function formatDocumentLabel({
  issuer,
  dueDate,
  periodEnd,
  documentKind = "unknown",
}: {
  issuer?: string | null;
  dueDate?: string | null;
  periodEnd?: string | null;
  documentKind?: FinancialDocumentKind | null;
}): string {
  const kindLabel =
    documentKind === "bank_statement"
      ? "Extrato"
      : documentKind === "invoice_nfe"
        ? "Nota fiscal"
        : documentKind === "credit_card_invoice"
          ? "Fatura"
          : "Documento";
  const origin = issuer?.trim() || kindLabel;
  const date = dueDate ?? periodEnd;
  if (date === null || date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return issuer?.trim() ? `${origin} · ${kindLabel}` : origin;
  }
  return `${origin} · ${kindLabel} ${SHORT_DATE.format(new Date(`${date}T12:00:00Z`))}`;
}

const MONTH_LABEL = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * `2026-06` como "junho de 2026".
 *
 * Mora aqui, junto do rótulo de fatura, porque a tela cruzada por operadora e a
 * conversa nomeiam os MESMOS meses: duas formatações independentes divergiriam
 * na primeira diferença de locale, e a pessoa leria "junho" num lugar e "Jun"
 * no outro para a mesma linha. Devolve o mês cru quando o formato não é
 * `YYYY-MM` — inventar um nome de mês seria pior que mostrar o código.
 */
export function formatMonthLabel(yearMonth: string): string {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return yearMonth;
  return MONTH_LABEL.format(new Date(`${yearMonth}-01T12:00:00Z`));
}
