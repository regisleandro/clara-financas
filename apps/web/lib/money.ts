import { formatCents } from "@clara-financas/ledger";

const MONEY_LABEL =
  /\b(valor|total|gasto|gastos|saldo|diferença|ajuste|custo|preço|pagamento|fatura|economia)\b/i;
const INTEGER_TEXT = /^-?\d+$/;

/**
 * Compatibilidade para painéis antigos que mandaram centavos no campo `text`.
 *
 * A regra do rótulo era uma ADIVINHAÇÃO, e ela errava do jeito mais visível
 * possível: "Total de assinaturas" casa `\btotal\b`, então o texto "6" virava
 * **R$ 0,06** na tela. A gêmea desta regex no schema recusava o painel inteiro
 * no mesmo caso — a Clara calculava certo, a validação reprovava, e a resposta
 * em texto apontava para um lado vazio.
 *
 * Agora o painel DECLARA o que o número é (`basis`), e não há o que adivinhar:
 * `count` é contagem e nunca vira moeda. A heurística sobrevive só para os
 * artefatos já persistidos, que não declaram nada — e é por isso que ela exige
 * `basis` ausente para agir.
 */
export function displayMetricValue(metric: {
  label: string;
  amount?: number;
  text?: string;
  basis?: string;
}): string {
  if (metric.amount !== undefined) return formatCents(metric.amount);

  const text = metric.text?.trim() ?? "";
  // Contagem é contagem. "6 assinaturas" nunca foi R$ 0,06.
  if (metric.basis === "count") return text === "" ? "—" : text;

  const declared = metric.basis !== undefined;
  if (!declared && MONEY_LABEL.test(metric.label) && INTEGER_TEXT.test(text)) {
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
