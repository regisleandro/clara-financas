import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";

import { transactions } from "../schema/ledger";

/**
 * O que faz um lançamento precisar de olho humano — a regra, em um lugar só.
 *
 * Ela vivia dentro de `apps/web/lib/review.ts`, atrás de `server-only`, o que
 * teve duas consequências. A primeira era conhecida: o badge da navegação e a
 * tela da fila precisam concordar sempre, senão o badge diz "3" e a tela abre
 * vazia. A segunda não era: **o agente não alcançava a fila**. A pessoa
 * perguntava "o que está para revisar sem categoria" e a Clara não tinha porta
 * nenhuma para essa informação — a resposta existia, na tela ao lado, e ela
 * respondia que não sabia.
 *
 * Copiar o predicado para o pacote do agente resolveria o acesso e criaria o
 * problema pior: duas definições de "precisa de revisão" divergindo com o
 * tempo. Então ele mora aqui, onde os dois chegam.
 */
export type ReviewReason = "sem_categoria" | "confianca_baixa" | "sem_comerciante";

/**
 * Gasto que precisa de categoria — pagamento e ajuste ficam fora.
 *
 * Pagamento de fatura não é gasto a classificar, e ajuste de saldo tampouco:
 * contá-los inflava o indicador com trabalho que não existe (nas duas primeiras
 * faturas reais, 4 dos 9 "sem categoria" eram um ou outro).
 *
 * Mora aqui, e não em cada consumidor, porque quatro lugares derivavam este
 * recorte por conta própria — o estado do razão, a triagem do guarda-livros, a
 * simulação das regras aprendidas e a fila de revisão — e dois deles haviam
 * divergido, contando pagamento. Dois números para a mesma pergunta, no mesmo
 * contexto, é o começo de uma resposta que pede desculpa.
 */
export const CATEGORIZABLE_KINDS = ["purchase", "refund", "fee"] as const;

function isCategorizable(kind: string): boolean {
  return (CATEGORIZABLE_KINDS as readonly string[]).includes(kind);
}

export function uncategorizedSpendCondition(): SQL | undefined {
  return and(isNull(transactions.category), inArray(transactions.kind, [...CATEGORIZABLE_KINDS]));
}

/**
 * Três motivos, e cada um dói de um jeito:
 *
 *  - **sem categoria** — toda análise por categoria fica com um buraco;
 *  - **confiança baixa** — o extrator avisou que pode ter lido errado, e o
 *    valor conta como gasto de qualquer forma;
 *  - **sem comerciante** — a linha não se agrupa com nada, nem em recorrência
 *    nem em regra aprendida.
 *
 * Sai da fila quem foi ATESTADO (`reviewedAt`), não quem "parece resolvido": a
 * conclusão mais comum de uma revisão é "a leitura já estava certa", e sem o
 * atestado esses itens voltariam para sempre.
 */
export function needsReviewCondition(): SQL | undefined {
  return and(isNull(transactions.reviewedAt), reviewFlagsCondition());
}

/**
 * Os mesmos três motivos, SEM o filtro do atestado.
 *
 * A separação existe porque o atestado e o motivo respondem a perguntas
 * diferentes, e confundi-las produziu uma resposta impossível de entender:
 * *"existem 2 itens sem categoria"* — dito pelo estado do razão, que não olha
 * `reviewedAt` — seguido de *"a consulta não retornou os itens"*, porque a fila
 * de revisão só enxerga o que ninguém atestou ainda. Um lançamento atestado com
 * a conclusão "a leitura estava certa, mas nenhuma categoria descreve isto"
 * está exatamente nesse limbo: conta no indicador e não aparece na fila.
 *
 * Com o predicado separado, a fila continua sendo a fila (o que espera olho
 * humano) e ainda assim alcança o item atestado quando a pergunta é sobre ele.
 */
export function reviewFlagsCondition(): SQL | undefined {
  return or(
    // "Sem categoria" aqui é o MESMO recorte do indicador do turno: pagamento
    // de fatura não espera categoria nenhuma, e marcá-lo assim tinha duas
    // consequências, uma pior que a outra. A pequena: ele nunca saía da fila,
    // porque a única coisa que o tiraria — uma categoria — jamais deveria
    // chegar. A grande: a fila devolvia 3 itens "sem categoria" onde o estado
    // do razão contava 2, e a resposta apresentava uma lista que não fechava
    // com o número dito na frase anterior.
    uncategorizedSpendCondition(),
    eq(transactions.extractionConfidence, "baixa"),
    isNull(transactions.merchant),
  );
}

/**
 * Por que ESTE lançamento está na fila. Pode ser mais de um motivo.
 *
 * Espelha `reviewFlagsCondition()` linha por linha — inclusive o `kind`. Quando
 * as duas discordavam, a consulta trazia a linha e a lista de motivos vinha
 * vazia: um item na fila sem nenhuma razão para estar nela.
 */
export function reviewReasonsFor(transaction: {
  category: string | null;
  merchant: string | null;
  kind: string;
  extractionConfidence: "alta" | "media" | "baixa";
}): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  if (transaction.category === null && isCategorizable(transaction.kind)) {
    reasons.push("sem_categoria");
  }
  if (transaction.extractionConfidence === "baixa") reasons.push("confianca_baixa");
  if (transaction.merchant === null) reasons.push("sem_comerciante");
  return reasons;
}
