import { and, eq, isNull, or, type SQL } from "drizzle-orm";

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
  return and(
    isNull(transactions.reviewedAt),
    or(
      isNull(transactions.category),
      eq(transactions.extractionConfidence, "baixa"),
      isNull(transactions.merchant),
    ),
  );
}

/** Por que ESTE lançamento está na fila. Pode ser mais de um motivo. */
export function reviewReasonsFor(transaction: {
  category: string | null;
  merchant: string | null;
  extractionConfidence: "alta" | "media" | "baixa";
}): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  if (transaction.category === null) reasons.push("sem_categoria");
  if (transaction.extractionConfidence === "baixa") reasons.push("confianca_baixa");
  if (transaction.merchant === null) reasons.push("sem_comerciante");
  return reasons;
}
