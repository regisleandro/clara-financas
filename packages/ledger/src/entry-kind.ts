import { countsTowardDeclaredTotal } from "./checksum";
import type { EntryKind, Transaction } from "./types";

/**
 * A natureza da linha, em português.
 *
 * `kind` é identificador interno e vinha vazando para a tela: o detalhe de cada
 * lançamento no painel de listagem escrevia `card_payment` e `cash_withdrawal`
 * literalmente. A regra do produto é a mesma que vale para categoria — a pessoa
 * lê o rótulo, nunca o slug —, e ela não tinha como ser cumprida porque o
 * rótulo não existia.
 */
const LABELS: Record<EntryKind, { one: string; many: string }> = {
  purchase: { one: "Compra", many: "Compras" },
  payment: { one: "Pagamento de fatura", many: "Pagamentos de fatura" },
  refund: { one: "Estorno", many: "Estornos" },
  fee: { one: "Encargo", many: "Encargos" },
  adjustment: { one: "Ajuste", many: "Ajustes" },
  income: { one: "Entrada", many: "Entradas" },
  transfer: { one: "Transferência", many: "Transferências" },
  card_payment: { one: "Pagamento com cartão", many: "Pagamentos com cartão" },
  cash_withdrawal: { one: "Saque", many: "Saques" },
};

export function entryKindLabel(kind: EntryKind): string {
  return LABELS[kind].one;
}

/**
 * O plural vem de uma tabela, não de `+ "s"`.
 *
 * Concatenar um "s" acerta em "Compra" e erra em "Pagamento com cartão", que
 * viraria "cartãos" na tela. Português não pluraliza por sufixo único, e um
 * rótulo escrito errado num painel financeiro custa a mesma confiança que um
 * número errado.
 */
export function entryKindLabelPlural(kind: EntryKind): string {
  return LABELS[kind].many;
}

/**
 * Como chamar um conjunto de lançamentos que NÃO são gasto.
 *
 * Existe por um defeito de meia correção: a listagem tinha um caso especial
 * para quando tudo era `payment`, porque somar gasto ali dava zero e o painel
 * anunciava "Gastos do recorte — R$ 0,00" com várias linhas de valor não-zero
 * logo abaixo. Mas `countsTowardDeclaredTotal` exclui QUATRO naturezas
 * (`payment`, `card_payment`, `transfer`, `income`) e o caso especial cobria
 * uma. Uma consulta só de `card_payment` — natureza que o extrator emite —
 * caía exatamente no buraco que a correção anterior dizia ter fechado.
 *
 * Aqui o rótulo é derivado do que ESTÁ no recorte, então não há lista de
 * exceções para manter em dia.
 */
export function nonSpendLabel(transactions: readonly Transaction[]): string {
  const kinds = [...new Set(transactions.map((entry) => entry.kind))];
  if (kinds.length === 0) return "Lançamentos";
  if (kinds.length === 1) return entryKindLabelPlural(kinds[0]!);
  return "Lançamentos que não são gasto";
}

/** Nenhuma linha do recorte conta como gasto — o total de gasto seria zero. */
export function hasNoSpend(transactions: readonly Transaction[]): boolean {
  return !transactions.some(countsTowardDeclaredTotal);
}
