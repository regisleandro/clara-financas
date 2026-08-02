import { batches } from "@clara-financas/db/schema/ledger";
import { desc, sql, type SQL } from "drizzle-orm";

/**
 * "A última fatura" — uma definição só, para todo mundo que responde isso.
 *
 * Havia três ordenações e elas discordavam. `invoice-focus.ts` usava
 * `periodEnd desc NULLS LAST`; `snapshot.ts` e `list_invoices.ts` usavam
 * `desc(periodEnd)`, que no PostgreSQL é NULLS **FIRST** por padrão.
 *
 * Lote sem `periodEnd` não é exótico: extração que não achou o ciclo, nota
 * fiscal, extrato bancário. Com a divergência, esse lote aparecia no TOPO do
 * bloco de estado que a Clara lê a cada turno e no FIM da lista que o
 * resolvedor consulta. A pessoa dizia "a última fatura", a Clara lia uma coisa
 * e `resolve_invoice_reference(latest)` devolvia outra.
 *
 * Pior no snapshot, que tem `limit(12)`: com nulls-first, doze lotes sem ciclo
 * empurram TODAS as faturas reais para fora do contexto do turno.
 *
 * NULLS LAST é a definição certa. Um documento sem ciclo não é o mais recente —
 * é o que não sabemos datar, e ordená-lo como se fosse o mais novo é afirmar
 * algo que o dado não diz.
 */
export function latestInvoiceOrder(): SQL[] {
  return [
    sql`${batches.periodEnd} desc nulls last`,
    desc(batches.createdAt),
    // Desempate estável: sem ele, dois lotes do mesmo instante trocam de lugar
    // entre consultas e "a última fatura" muda sozinha entre um turno e outro.
    desc(batches.id),
  ];
}
