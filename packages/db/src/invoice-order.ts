import { batches } from "./schema/ledger";
import { asc, desc, sql, type SQL } from "drizzle-orm";

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
 *
 * Mora em `@clara-financas/db`, e não no pacote do agente onde nasceu, porque
 * havia um QUARTO lugar ordenando faturas à mão: `apps/web/lib/starters.ts`,
 * que monta o atalho "comparar as duas últimas". Ele repetia o `desc()` cru e
 * portanto o nulls-first — então o atalho podia oferecer a comparação de dois
 * lotes sem ciclo enquanto a conversa falava de outras duas faturas. A web não
 * alcança o pacote do agente; alcança este. Uma definição, quatro chamadores.
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

/**
 * A mesma definição, do mais antigo para o mais novo — a leitura mês a mês.
 *
 * Mora aqui, e não solta no `list_invoices`, porque a regra dos nulos é a mesma
 * e precisa continuar sendo: um lote sem ciclo não é o mais recente **nem** o
 * mais antigo, é o que não sabemos datar. `nulls last` nos dois sentidos é o
 * que mantém essa afirmação coerente — inverter a ordem não pode transformar
 * "não sei quando" em "foi o primeiro".
 */
export function oldestInvoiceOrder(): SQL[] {
  return [
    sql`${batches.periodEnd} asc nulls last`,
    asc(batches.createdAt),
    asc(batches.id),
  ];
}
