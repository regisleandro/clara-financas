import "server-only";

import { getDb } from "@clara-financas/db";
import { batches, documents, transactions } from "@clara-financas/db/schema/ledger";
import { latestInvoiceOrder } from "@clara-financas/db/invoice-order";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { formatCents } from "@clara-financas/ledger";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { describeInvoice } from "@/lib/invoice-name";
import type { Starter } from "@/components/chat-welcome";

/**
 * Os atalhos da tela de boas-vindas, derivados do razão.
 *
 * Antes eram quatro constantes no componente, iguais para todo mundo e em todo
 * estado. Duas delas eram becos sem saída garantidos para quem está começando:
 * "Comparar com o período anterior" sem período anterior, e "Encontrar
 * recorrências" com uma fatura só. Um atalho que não pode funcionar é pior que
 * atalho nenhum — ele ensina que a ferramenta não responde.
 *
 * Aqui cada atalho só aparece quando há dado que o sustente, e a ordem segue o
 * que é mais útil AGORA: decisão pendente primeiro, depois divergência aberta,
 * depois vencimento próximo, depois análise.
 */

const MAX_STARTERS = 4;

/** Sempre presente: é a única ação que funciona com o razão vazio. */
const UPLOAD: Starter = {
  title: "Enviar um documento",
  note: "Fatura, extrato ou nota fiscal em PDF",
  prompt: null,
};

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );


export async function loadStarters(tenantId: string): Promise<Starter[]> {
  const db = getDb();

  const state = await forTenant(
    tenantId,
    async (tx) => {
      const invoices = await tx
        .select({
          batchId: batches.id,
          status: batches.status,
          issuer: documents.issuer,
          periodStart: batches.periodStart,
          periodEnd: batches.periodEnd,
          dueDate: batches.dueDate,
          checksumResult: batches.checksumResult,
        })
        .from(batches)
        .innerJoin(documents, eq(documents.id, batches.documentId))
        .where(inArray(batches.status, ["proposed", "confirmed"]))
        // A MESMA definição de "a última fatura" que a conversa usa. Escrito à
        // mão aqui, era `desc()` cru — que no PostgreSQL é NULLS FIRST, então
        // um lote sem ciclo (nota fiscal, extrato, extração que não achou o
        // período) encabeçava a lista e o atalho oferecia comparar dois
        // documentos que não são as duas últimas faturas de ninguém.
        .orderBy(...latestInvoiceOrder());

      const [uncategorized] = await tx
        .select({
          count: sql<number>`count(*)::int`,
          totalCents: sql<number>`coalesce(sum(${transactions.amount}), 0)::int`,
        })
        .from(transactions)
        .where(
          and(
            inArray(transactions.status, ["confirmed", "adjustment"]),
            isNull(transactions.category),
            // Pagamento e ajuste não são gasto a classificar.
            inArray(transactions.kind, ["purchase", "refund", "fee"]),
          ),
        );

      return { invoices, uncategorized };
    },
    db,
  );

  const confirmed = state.invoices.filter((invoice) => invoice.status === "confirmed");
  const pending = state.invoices.find((invoice) => invoice.status === "proposed");
  const starters: Starter[] = [];

  // Uma decisão parada é sempre o assunto mais urgente da tela.
  if (pending !== undefined) {
    starters.push({
      title: "Terminar a conferência",
      note: `${pending.issuer ?? "Uma fatura"} está esperando a sua decisão`,
      prompt: `Retome a conferência da ${describeInvoice(pending)} e me mostre o que falta decidir.`,
    });
  }

  const divergent = confirmed.find((invoice) => invoice.checksumResult === "mismatch");
  if (divergent !== undefined) {
    starters.push({
      title: "Ver a divergência",
      note: `A soma de uma fatura de ${divergent.issuer ?? "cartão"} não fecha`,
      prompt: `A conferência da ${describeInvoice(divergent)} deu divergência. Me mostre onde está a diferença.`,
    });
  }

  if (confirmed.length >= 2) {
    const [current, previous] = confirmed;
    /*
     * Duas faturas do mesmo emissor no mesmo mês descrevem-se igual — e a frase
     * viraria "compare a fatura do Nubank de junho com a fatura do Nubank de
     * junho", que não pede nada. Acontece de verdade: fatura parcial e
     * fechamento do mesmo ciclo, ou o mesmo PDF enviado duas vezes.
     *
     * Aí a data de fechamento entra como desempate. Ela é visível na tela (está
     * na nota do próprio atalho) e não é identificador — continua sendo um fato
     * da fatura, não um id do banco.
     */
    const [atual, anterior] =
      describeInvoice(current!) === describeInvoice(previous!) &&
      current!.periodEnd !== null &&
      previous!.periodEnd !== null
        ? [
            `${describeInvoice(current!)} fechada em ${shortDate(current!.periodEnd)}`,
            `${describeInvoice(previous!)} fechada em ${shortDate(previous!.periodEnd)}`,
          ]
        : [describeInvoice(current!), describeInvoice(previous!)];

    starters.push({
      title: "Comparar as duas últimas faturas",
      note:
        current?.periodEnd && previous?.periodEnd
          ? `Ciclos até ${shortDate(previous.periodEnd)} e ${shortDate(current.periodEnd)}`
          : "O que subiu, o que caiu e por quê",
      prompt: `Compare a ${atual} com a ${anterior}. O que explica a diferença?`,
    });
  }

  if (confirmed.length >= 1) {
    const latest = confirmed[0]!;
    starters.push({
      title: "Ver onde foi o dinheiro",
      note: latest.periodEnd
        ? `Composição da fatura fechada em ${shortDate(latest.periodEnd)}`
        : "Composição por categoria da última fatura",
      prompt: `Mostre a composição por categoria da ${describeInvoice(latest)}.`,
    });
  }

  // Recorrência só se sustenta com duas faturas: com uma, não há intervalo a
  // medir e o atalho levaria a "não encontrei nada".
  if (confirmed.length >= 2) {
    starters.push({
      title: "Encontrar assinaturas",
      note: "O que repete todo mês e quanto custa por ano",
      prompt: "O que está repetindo todo mês? Mostre o custo anual de cada uma.",
    });
  }

  if (state.uncategorized !== undefined && state.uncategorized.count > 0) {
    starters.push({
      title: "Resolver o que ficou sem categoria",
      note: `${state.uncategorized.count} ${
        state.uncategorized.count === 1 ? "lançamento" : "lançamentos"
      } · ${formatCents(state.uncategorized.totalCents)}`,
      prompt:
        "Quais lançamentos ainda estão sem categoria? Me ajude a resolver e a guardar as regras.",
    });
  }

  // O upload tem lugar GARANTIDO, e o corte cai sobre os derivados.
  //
  // Cortar a lista inteira em quatro parecia certo até rodar contra um razão
  // movimentado: com decisão pendente, divergência, comparação e composição,
  // o upload era o quinto e sumia — justamente a ação mais comum de quem abre
  // a tela, que é chegar com a fatura do mês. Ele continua alcançável pelo "+"
  // do compositor, mas depender disso é esconder o caminho principal.
  //
  // Primeiro quando não há razão: sem dado, é a única coisa que funciona.
  return confirmed.length === 0 && pending === undefined
    ? [UPLOAD, ...starters].slice(0, MAX_STARTERS)
    : [...starters.slice(0, MAX_STARTERS - 1), UPLOAD];
}

/**
 * Follow-ups depois de uma resposta.
 *
 * Mesma regra dos atalhos: só oferece o que o razão sustenta. "Comparar com o
 * período anterior" com uma fatura só era um convite a uma resposta vazia.
 */
export async function loadFollowups(tenantId: string): Promise<string[]> {
  const db = getDb();

  const [count] = await forTenant(
    tenantId,
    async (tx) =>
      tx
        .select({ value: sql<number>`count(*)::int` })
        .from(batches)
        .where(eq(batches.status, "confirmed")),
    db,
  );

  const invoices = count?.value ?? 0;
  const followups = ["Detalhar por categoria"];

  if (invoices >= 2) {
    followups.push("Comparar com a fatura anterior", "O que repete todo mês?");
  }
  followups.push("O que ficou sem categoria?");

  return followups;
}
