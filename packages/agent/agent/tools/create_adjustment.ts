import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { batches, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { formatCents } from "@clara-financas/ledger";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { notFound, refused } from "../lib/errors";
import { recomputeBatchChecksum } from "../lib/recompute-checksum";
import { requireTenantCaller, tenantIdOf } from "../lib/tenant";

/**
 * A linha de ajuste — a correção depois que a fatura já entrou no razão.
 *
 * O mecanismo estava desenhado desde o início e nunca foi construído. O trigger
 * `clara_transactions_immutable` recusa mudar valor, data ou natureza de um
 * lançamento confirmado, e a mensagem que ele devolve manda "registrar um
 * ajuste"; `edit_proposed_batch` dizia o mesmo. Só que
 * `transactions.status = 'adjustment'` e `adjusts_transaction_id` não eram
 * escritos por nenhum código de produção. O banco e as tools instruíam o modelo
 * a executar uma ação que não existia — e o resultado, em produção, foi a Clara
 * anunciando que não conseguia ajustar a fatura.
 *
 * **É um DELTA, não uma substituição.** A linha original continua lá, intacta,
 * porque é o que o documento dizia; o ajuste soma por cima. Corrigir R$ 100,00
 * para R$ 90,00 é um ajuste de −R$ 10,00, e o total passa a fechar em R$ 90,00
 * com as duas linhas visíveis. Substituir apagaria a evidência do erro, que é
 * justamente o que a auditoria precisa enxergar.
 */
export default defineTool({
  description:
    "Requests approval to record a correction to an entry already confirmed in the ledger. The amount is a DELTA, not a replacement: to fix 100.00 that should be 90.00, pass -1000 (cents). The original entry stays untouched and the adjustment sums on top, so the trail shows both. Use when edit_proposed_batch refuses because the invoice was already recorded. Entry ids come from read_batch or the analyst.",
  inputSchema: z.object({
    transactionId: z.string().min(1).describe("The confirmed entry being corrected."),
    amountCents: z
      .number()
      .int()
      .describe(
        "The DIFFERENCE in cents, signed. Negative reduces the total, positive increases it. Never the new value.",
      ),
    reason: z
      .string()
      .min(1)
      .describe("Why the correction exists, in Brazilian Portuguese. Shown to the person."),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Defaults to the date of the corrected entry, so period totals stay right."),
  }),

  approval: (ctx) => {
    const current = tenantIdOf(ctx.session.auth.current);
    if (current === undefined || current !== tenantIdOf(ctx.session.auth.initiator)) {
      return { type: "denied", reason: "A sessão não está fixada a um único usuário." };
    }
    return "user-approval";
  },

  async execute(input, ctx) {
    const { tenantId, userId } = requireTenantCaller(ctx);

    if (input.amountCents === 0) {
      return refused("operacao_nao_permitida", "Um ajuste de R$ 0,00 não corrige nada.", {
        hint: "Se a leitura já estava certa, use mark_reviewed em vez de um ajuste.",
      });
    }

    return forTenant(
      tenantId,
      async (tx) => {
        const [original] = await tx
          .select()
          .from(transactions)
          .where(and(eq(transactions.id, input.transactionId), eq(transactions.tenantId, tenantId)))
          .limit(1);

        if (original === undefined) {
          return notFound(
            "lancamento_nao_encontrado",
            `Nenhum lançamento com o id ${input.transactionId}.`,
            { hint: "Chame read_batch para pegar os ids desta fatura." },
          );
        }

        // Ajustar rascunho seria criar duas linhas onde uma edição resolve — e
        // deixaria a conferência do lote sem fechar, porque o ajuste entra na
        // soma extraída e o documento não o declara.
        if (original.status === "proposed") {
          return refused(
            "operacao_nao_permitida",
            "Esta fatura ainda é rascunho: aqui a correção é direta, sem linha de ajuste.",
            { hint: "Chame edit_proposed_batch com o mesmo transactionId." },
          );
        }

        const id = `txn_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
        await tx.insert(transactions).values({
          id,
          tenantId,
          // Mesmo lote e mesmo documento: o ajuste pertence à fatura que ele
          // corrige, senão o total daquela fatura continuaria errado.
          batchId: original.batchId,
          sourceDocumentId: original.sourceDocumentId,
          status: "adjustment",
          adjustsTransactionId: original.id,
          date: input.date ?? original.date,
          originalDescription: `Ajuste: ${input.reason}`,
          merchant: original.merchant,
          // A identidade do comerciante é herdada de propósito: o ajuste tem de
          // agrupar com o gasto que corrige, ou "quanto gastei na padaria"
          // passa a ignorar a correção.
          merchantKey: original.merchantKey,
          amount: input.amountCents,
          kind: "adjustment",
          category: original.category,
          // Não foi lido de documento nenhum: veio de uma decisão humana.
          extractionConfidence: "alta",
          reviewedAt: new Date(),
          reviewedBy: `human:${userId}`,
        });

        // O ajuste entra na soma extraída (`countsTowardDeclaredTotal` só
        // exclui pagamento), então ele pode FECHAR a divergência do lote — e
        // sem reconferir aqui, a fatura já corrigida continuava marcada como
        // divergente na tela de revisão, nos starters e no snapshot, para
        // sempre.
        const [batch] = await tx
          .select()
          .from(batches)
          .where(and(eq(batches.id, original.batchId), eq(batches.tenantId, tenantId)))
          .limit(1);
        const rechecked = batch
          ? await recomputeBatchChecksum(tx, tenantId, batch)
          : null;

        return {
          adjustmentId: id,
          adjustsTransactionId: original.id,
          batchId: original.batchId,
          amountCents: input.amountCents,
          amountFormatted: formatCents(input.amountCents),
          originalAmountCents: original.amount,
          resultingAmountCents: original.amount + input.amountCents,
          resultingAmountFormatted: formatCents(original.amount + input.amountCents),
          auditedBy: `human:${userId}`,
          ...(rechecked !== null ? { checksum: rechecked.checksum } : {}),
          note: "A linha original continua no razão; o ajuste soma por cima. As duas aparecem na fatura. O campo checksum diz se a conferência da fatura fechou com o ajuste — se fechou, diga isso à pessoa.",
        };
      },
      getDb(),
    );
  },
});
