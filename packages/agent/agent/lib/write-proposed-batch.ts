import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { batches, documents, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import {
  ProposedBatchSchema,
  formatDocumentLabel,
  merchantKey,
  verifyChecksum,
  verifyStatementBalance,
  type ChecksumReport,
  type StatementBalanceReport,
} from "@clara-financas/ledger";
import { and, eq, inArray, sql } from "drizzle-orm";

import { notFound, refused, toolError, type ToolError } from "./errors";
import { canonicalIssuer } from "./issuer-canonical";

/**
 * A escrita do lote proposto, compartilhada.
 *
 * Era o corpo de `propose_batch`; virou helper quando a proposta ganhou um
 * segundo caminho — `propose_batch_from_extraction`, que monta o mesmo lote a
 * partir da staging em vez do input do modelo. Mesmo movimento do
 * `recompute-checksum.ts`: dois chamadores com cópias divergentes é como o
 * rascunho começa a depender de qual porta o criou.
 *
 * O que mora aqui, nesta ordem e NUMA transação só:
 *  1. documento existe;
 *  2. documento já registrado recusa (propor de novo duplicaria o gasto);
 *  3. rascunho EDITADO não é apagado em silêncio — ver abaixo;
 *  4. rascunho intocado é substituído (idempotência por documento);
 *  5. lote + linhas entram; o emissor sobe ao documento se ele não tinha.
 */

export type ProposedTransactionInput = {
  date: string;
  originalDescription: string;
  merchant?: string | null;
  amount: number;
  kind?:
    | "purchase"
    | "payment"
    | "refund"
    | "fee"
    | "adjustment"
    | "income"
    | "transfer"
    | "card_payment"
    | "cash_withdrawal";
  installment?: { current: number; total: number } | null;
  category?: string | null;
  extractionConfidence: "alta" | "media" | "baixa";
  page?: number | null;
};

export type ProposedBatchWriteInput = {
  documentId: string;
  documentKind?: "unknown" | "credit_card_invoice" | "bank_statement" | "invoice_nfe";
  issuer?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  dueDate?: string | null;
  declaredTotal?: number | null;
  declaredSubtotals?: { fees?: number | null; purchases?: number | null } | null;
  openingBalance?: number | null;
  closingBalance?: number | null;
  transactions: ProposedTransactionInput[];
  /**
   * Consente substituir um rascunho que já recebeu correções humanas.
   *
   * `propose_batch` sempre apagou o rascunho anterior do documento — a
   * idempotência que acabou com os 5 lotes fantasmas. Mas apagar um rascunho
   * com dez turnos de `edit_proposed_batch` porque a Clara entendeu "reenvie"
   * como "reproponha" descartava trabalho humano sem cartão nenhum. Sem esta
   * flag, um rascunho editado recusa com `rascunho_editado`; com ela, o
   * chamador declara que a pessoa confirmou a substituição.
   */
  overwriteEditedDraft?: boolean;
};

export type DuplicateSuspect = {
  date: string;
  amountCents: number;
  merchant: string | null;
  existingTransactionId: string;
  existingBatchId: string;
};

export type ProposedBatchWriteResult =
  | (ToolError & { batchId?: string })
  | {
      batchId: string;
      documentKind: "unknown" | "credit_card_invoice" | "bank_statement" | "invoice_nfe";
      issuer: string | null;
      invoiceLabel: string;
      periodEnd: string | null;
      dueDate: string | null;
      transactionCount: number;
      checksum: ChecksumReport;
      statementBalance?: StatementBalanceReport;
      duplicateSuspects?: { count: number; sample: DuplicateSuspect[] };
    };

const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

export async function writeProposedBatch(
  tenantId: string,
  input: ProposedBatchWriteInput,
): Promise<ProposedBatchWriteResult> {
  const db = getDb();

  const found = await forTenant(
    tenantId,
    async (tx) => {
      const [document] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, input.documentId), eq(documents.tenantId, tenantId)))
        .limit(1);
      return { document };
    },
    db,
  );

  if (found.document === undefined) {
    return notFound("documento_nao_encontrado", `Nenhum documento com o id ${input.documentId}.`, {
      hint: "Os documentId chegam no contexto do upload e aparecem em list_documents.",
    });
  }
  const document = found.document;

  const prepared = input.transactions.map((transaction) => ({
    ...transaction,
    id: id("txn"),
    merchant: transaction.merchant ?? null,
    // A identidade do comerciante é derivada AQUI, na fronteira, e não pelo
    // extrator. O extrator é isolado do razão de propósito, então ele não
    // tem como saber que "Anthropic* Claude Sub" já apareceu como outra
    // grafia — e pedir que ele normalize produziria uma normalização
    // diferente a cada documento. Determinístico, testado, fora do modelo.
    merchantKey: merchantKey({
      originalDescription: transaction.originalDescription,
      merchant: transaction.merchant ?? null,
    }),
    kind: transaction.kind ?? ("purchase" as const),
    installment: transaction.installment ?? null,
    category: transaction.category ?? null,
    page: transaction.page ?? null,
    sourceDocument: document.id,
  }));

  const documentKind = input.documentKind ?? document.kind;

  // Revalidação no executor. O modelo (ou a staging) produziu estes dados;
  // confiar neles sem passar pelo schema seria deixar quem os produziu definir
  // o formato do razão.
  const batch = ProposedBatchSchema.parse({
    documentId: document.id,
    documentKind,
    issuer: input.issuer ?? document.issuer ?? null,
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    dueDate: input.dueDate ?? null,
    declaredTotal: input.declaredTotal ?? null,
    declaredSubtotals:
      input.declaredSubtotals == null
        ? null
        : {
            fees: input.declaredSubtotals.fees ?? null,
            purchases: input.declaredSubtotals.purchases ?? null,
          },
    openingBalance: input.openingBalance ?? null,
    closingBalance: input.closingBalance ?? null,
    transactions: prepared,
  });

  const checksum = verifyChecksum(batch);
  const statementBalance =
    batch.documentKind === "bank_statement"
      ? verifyStatementBalance(batch.transactions, batch.openingBalance, batch.closingBalance)
      : undefined;
  const persistedChecksumResult =
    statementBalance === undefined
      ? checksum.result
      : statementBalance.result === "match"
        ? "match"
        : statementBalance.result === "mismatch"
          ? "mismatch"
          : "no_declared_total";
  const persistedChecksumReport = statementBalance ?? checksum;
  const batchId = id("bat");

  /**
   * UMA transação para a proposta inteira.
   *
   * Eram quatro — ler o documento, apagar o rascunho velho, conferir se já
   * foi registrado, gravar —, e entre elas o banco ficava num estado que não
   * existe em lugar nenhum do desenho: uma falha depois do apagamento e
   * antes da gravação deixava o documento SEM lote nenhum, com a fatura
   * anterior já destruída. Aqui ou tudo entra, ou nada muda.
   *
   * A ordem também importa: "já registrado" vem ANTES do apagamento. Fazendo
   * depois, recusar a proposta já havia destruído o rascunho.
   */
  const written = await forTenant(
    tenantId,
    async (tx) => {
      const [confirmed] = await tx
        .select({ id: batches.id })
        .from(batches)
        .where(
          and(
            eq(batches.tenantId, tenantId),
            eq(batches.documentId, document.id),
            eq(batches.status, "confirmed"),
          ),
        )
        .limit(1);

      if (confirmed) {
        return {
          ...refused("documento_ja_registrado", "Este documento já está registrado no razão.", {
            hint: "Não proponha de novo. Para corrigir algo nela, chame read_batch e depois create_adjustment.",
          }),
          batchId: confirmed.id,
        };
      }

      // Rascunho que a pessoa já corrigiu não some em silêncio. O detector é
      // `updated_at > created_at`: um rascunho recém-proposto tem os dois
      // carimbos no mesmo instante, e toda chamada de `edit_proposed_batch`
      // termina na reconferência, que atualiza o lote. Sem consentimento
      // explícito, a proposta nova recusa e ensina o caminho.
      if (input.overwriteEditedDraft !== true) {
        const [edited] = await tx
          .select({ id: batches.id })
          .from(batches)
          .where(
            and(
              eq(batches.tenantId, tenantId),
              eq(batches.documentId, document.id),
              eq(batches.status, "proposed"),
              sql`${batches.updatedAt} > ${batches.createdAt}`,
            ),
          )
          .limit(1);

        if (edited) {
          return {
            ...toolError(
              "rascunho_editado",
              "Este documento já tem um rascunho com correções feitas — propor de novo as descartaria.",
              {
                hint: "Confirme com a pessoa se ela quer descartar as correções e recomeçar; se sim, repita a chamada com overwriteEditedDraft: true. Para continuar de onde parou, use read_batch e edit_proposed_batch.",
                retryable: true,
              },
            ),
            batchId: edited.id,
          };
        }
      }

      // Idempotência por documento: reprocessar a mesma fatura NÃO pode criar
      // um segundo rascunho. Sem isto, cada tentativa deixava um lote órfão —
      // foram 5 lotes e 374 transações fantasmas do mesmo PDF em teste real.
      const stale = await tx
        .select({ id: batches.id })
        .from(batches)
        .where(
          and(
            eq(batches.tenantId, tenantId),
            eq(batches.documentId, document.id),
            eq(batches.status, "proposed"),
          ),
        );

      for (const row of stale) {
        // Só rascunho sai; o trigger do banco protege o que foi confirmado.
        await tx.delete(transactions).where(eq(transactions.batchId, row.id));
        await tx.delete(batches).where(eq(batches.id, row.id));
      }

      await tx.insert(batches).values({
        id: batchId,
        tenantId,
        documentId: document.id,
        status: "proposed",
        periodStart: batch.periodStart,
        periodEnd: batch.periodEnd,
        dueDate: batch.dueDate,
        declaredTotal: batch.declaredTotal,
        declaredSubtotals: batch.declaredSubtotals,
        openingBalance: batch.openingBalance,
        closingBalance: batch.closingBalance,
        extractedTotal: checksum.extractedTotal,
        checksumResult: persistedChecksumResult,
        checksumReport: persistedChecksumReport,
      });

      if (input.documentKind !== undefined && document.kind !== input.documentKind) {
        await tx
          .update(documents)
          .set({ kind: input.documentKind })
          .where(and(eq(documents.id, document.id), eq(documents.tenantId, tenantId)));
      }

      // O emissor mora no documento, não no lote — é propriedade do papel,
      // não da tentativa de leitura. E a grafia converge: se a mesma operadora
      // já existe com outra caixa/acento, a grafia registrada vence.
      if (batch.issuer !== null && document.issuer === null) {
        await tx
          .update(documents)
          .set({ issuer: await canonicalIssuer(tx, tenantId, batch.issuer) })
          .where(and(eq(documents.id, document.id), eq(documents.tenantId, tenantId)));
      }

      if (batch.transactions.length > 0) {
        await tx.insert(transactions).values(
          batch.transactions.map((transaction) => ({
            id: transaction.id,
            tenantId,
            batchId,
            status: "proposed" as const,
            date: transaction.date,
            originalDescription: transaction.originalDescription,
            merchant: transaction.merchant,
            merchantKey: transaction.merchantKey,
            amount: transaction.amount,
            kind: transaction.kind,
            installmentCurrent: transaction.installment?.current ?? null,
            installmentTotal: transaction.installment?.total ?? null,
            category: transaction.category,
            extractionConfidence: transaction.extractionConfidence,
            sourceDocumentId: document.id,
            page: transaction.page,
          })),
        );
      }

      /**
       * A suspeita de DUPLA CONTAGEM — o caso documentado no README que as
       * duas conferências deixam passar: a fatura parcial aprovada e a fatura
       * fechada do mesmo ciclo chegam como DOCUMENTOS diferentes (hashes
       * diferentes), cada uma fecha contra o próprio total declarado, e o
       * gasto entra duas vezes no razão. Aqui, cada linha proposta é comparada
       * com o que JÁ ESTÁ CONFIRMADO vindo de outros documentos: mesma data,
       * mesmo valor, mesma identidade de comerciante. É AVISO, não bloqueio —
       * duas compras idênticas no mesmo dia existem de verdade, e quem decide
       * é a pessoa, com os ids na mão para conferir.
       */
      const dates = [...new Set(batch.transactions.map((transaction) => transaction.date))];
      let suspects: DuplicateSuspect[] = [];
      if (dates.length > 0) {
        const candidates = await tx
          .select({
            id: transactions.id,
            batchId: transactions.batchId,
            date: transactions.date,
            amount: transactions.amount,
            merchant: transactions.merchant,
            merchantKey: transactions.merchantKey,
            sourceDocumentId: transactions.sourceDocumentId,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.tenantId, tenantId),
              eq(transactions.status, "confirmed"),
              inArray(transactions.date, dates),
            ),
          );

        const byFingerprint = new Map<string, (typeof candidates)[number]>();
        for (const candidate of candidates) {
          if (candidate.sourceDocumentId === document.id) continue;
          byFingerprint.set(
            `${candidate.date}|${candidate.amount}|${candidate.merchantKey}`,
            candidate,
          );
        }

        suspects = batch.transactions.flatMap((transaction) => {
          const match = byFingerprint.get(
            `${transaction.date}|${transaction.amount}|${transaction.merchantKey}`,
          );
          return match === undefined
            ? []
            : [
                {
                  date: transaction.date,
                  amountCents: transaction.amount,
                  merchant: transaction.merchant,
                  existingTransactionId: match.id,
                  existingBatchId: match.batchId,
                },
              ];
        });
      }

      return { ok: true as const, suspects };
    },
    db,
  );

  if ("error" in written) return written;

  return {
    batchId,
    documentKind: input.documentKind ?? document.kind,
    issuer: batch.issuer,
    invoiceLabel: formatDocumentLabel({ ...batch, documentKind: batch.documentKind }),
    periodEnd: batch.periodEnd,
    dueDate: batch.dueDate,
    transactionCount: batch.transactions.length,
    checksum,
    ...(statementBalance === undefined ? {} : { statementBalance }),
    ...(written.suspects.length > 0
      ? {
          duplicateSuspects: {
            count: written.suspects.length,
            sample: written.suspects.slice(0, 10),
          },
        }
      : {}),
  };
}
