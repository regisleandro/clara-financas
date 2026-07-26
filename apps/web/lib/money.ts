import { formatCents } from "@clara-financas/ledger";

const MONEY_LABEL =
  /\b(valor|total|gasto|gastos|saldo|diferença|ajuste|custo|preço|pagamento|fatura|economia)\b/i;
const INTEGER_TEXT = /^-?\d+$/;

/**
 * Compatibilidade para painéis antigos que mandaram centavos no campo `text`.
 *
 * Painéis novos são recusados pelo schema e precisam usar `amount`. Esta
 * função existe para que uma sessão já persistida com `text: "5000000"` não
 * continue mostrando centavos crus para sempre. Só converte quando o rótulo
 * deixa claro que se trata de dinheiro; "6 assinaturas" continua sendo texto.
 */
export function displayMetricValue(metric: {
  label: string;
  amount?: number;
  text?: string;
}): string {
  if (metric.amount !== undefined) return formatCents(metric.amount);

  const text = metric.text?.trim() ?? "";
  if (MONEY_LABEL.test(metric.label) && INTEGER_TEXT.test(text)) {
    const cents = Number(text);
    if (Number.isSafeInteger(cents)) return formatCents(cents);
  }
  return text === "" ? "—" : text;
}

/** Mesma proteção para o artefato legado de conferência. */
export function displayArtifactValue(label: string, value: string): string {
  const text = value.trim();
  if (MONEY_LABEL.test(label) && INTEGER_TEXT.test(text)) {
    const cents = Number(text);
    if (Number.isSafeInteger(cents)) return formatCents(cents);
  }
  return value;
}
