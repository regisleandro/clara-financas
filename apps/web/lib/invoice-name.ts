import { formatMonthLabel } from "@clara-financas/ledger";

/**
 * Como uma pessoa nomeia uma fatura — e por que o id não pode aparecer aqui.
 *
 * Os atalhos da tela de boas-vindas escreviam o `batchId` dentro da mensagem:
 * quem clicava em "Comparar as duas últimas faturas" via, como se tivesse
 * digitado, *"Compare a fatura bat_52513dece22e438b9ee9 com a
 * bat_cdcff3fbdb3648909b63"*. E isso sobrevivia à conversa inteira: o título no
 * menu lateral sai da primeira mensagem, então ficava o id truncado no lugar do
 * assunto.
 *
 * A regra "identificador nunca chega à pessoa" já existia — está no prompt do
 * coordenador e tem teste — mas valia para o que a CLARA escreve. O front
 * escapava dela pela porta dos fundos, pondo o id na fala da própria pessoa.
 *
 * Mora em módulo próprio, e não dentro de `starters.ts`, por um motivo
 * prático: `starters` é `server-only` e não pode ser importado por um teste.
 * Uma regra sem teste é como esta voltou a ser quebrada.
 *
 * A descrição usa só o que está VISÍVEL na tela: emissor e mês do ciclo. É o
 * suficiente para a coordenadora resolver por `list_invoices` (que devolve o
 * mesmo emissor e o mesmo ciclo) e é o que a pessoa diria em voz alta. Sem
 * ciclo, o emissor sozinho; sem os dois, "a última fatura" — vago de propósito,
 * porque inventar precisão que o dado não tem é pior que a vagueza.
 *
 * Devolve o sintagma SEM artigo ("fatura do Nubank de junho de 2026"), e quem
 * chama põe o artigo que a frase pede. Com o artigo embutido saía "composição
 * por categoria DE A fatura do Nubank" — erro que só apareceu ao rodar contra o
 * banco de verdade, porque o teste comparava a descrição isolada e nunca a
 * frase montada.
 */
export function describeInvoice(invoice: {
  issuer: string | null;
  periodEnd: string | null;
}): string {
  const issuer = invoice.issuer?.trim();
  const month =
    invoice.periodEnd === null || invoice.periodEnd === ""
      ? null
      : formatMonthLabel(invoice.periodEnd.slice(0, 7));
  if (issuer !== undefined && issuer !== "" && month !== null) {
    return `fatura do ${issuer} de ${month}`;
  }
  if (issuer !== undefined && issuer !== "") return `fatura do ${issuer}`;
  if (month !== null) return `fatura de ${month}`;
  return "última fatura";
}

/**
 * O formato de identificador que NUNCA pode aparecer numa fala da pessoa.
 *
 * Explícito porque a regra é fácil de reintroduzir: qualquer template novo que
 * interpole uma linha do banco pode trazer um id junto, e ninguém percebe até
 * ver o próprio menu lateral cheio de `bat_…`. O teste ao lado varre as
 * mensagens que os atalhos produzem contra este padrão.
 */
export const IDENTIFIER_PATTERN = /\b(?:bat|doc|txn|art|ext|prop|ses|tnt|cpt)_[a-z0-9]{6,}/i;
