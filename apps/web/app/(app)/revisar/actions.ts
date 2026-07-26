"use server";

import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { concepts } from "@clara-financas/db/schema/knowledge";
import { documents, transactions } from "@clara-financas/db/schema/ledger";
import { transactionReclassifications } from "@clara-financas/db/schema/reclassification";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { merchantKey } from "@clara-financas/ledger";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/lib/review-types";
import { getTenantContext } from "@/lib/tenant";

/**
 * As escritas da revisão manual.
 *
 * Mesma disciplina da tool `recategorize_transactions`, e de propósito: o
 * caminho humano não é um atalho que escapa da auditoria. Categoria e
 * comerciante são LEITURA e podem mudar; valor, data, descrição e origem são
 * FATO e o trigger do banco recusa qualquer tentativa. Cada mudança de leitura
 * grava uma linha em `transaction_reclassifications` com autor `human:<id>`.
 *
 * O que é novo aqui é o ATESTADO: `reviewedAt`/`reviewedBy` marcam que uma
 * pessoa olhou. Ele é gravado mesmo quando nada muda — "a Clara leu certo" é a
 * conclusão mais comum de uma revisão, e é o que tira o item da fila.
 *
 * Nenhuma action confia no tenant vindo do cliente: ele sai sempre da sessão.
 */

export async function reviewTransaction(input: {
  transactionId: string;
  /** `null` deixa a transação sem categoria — decisão legítima, não omissão. */
  category: string | null;
  merchant: string | null;
  reason: string | null;
}): Promise<ActionResult> {
  const context = await getTenantContext();
  if (!context) return { ok: false, error: "Sessão expirada. Entre novamente." };
  if (context.status !== "ready") return { ok: false, error: "Seu espaço ainda está sendo preparado." };

  const { tenantId, userId } = context;
  const category = normalize(input.category);
  const merchant = normalize(input.merchant);
  const reason = normalize(input.reason);

  const result = await forTenant(
    tenantId,
    async (tx) => {
      const [current] = await tx
        .select({
          id: transactions.id,
          category: transactions.category,
          merchant: transactions.merchant,
          originalDescription: transactions.originalDescription,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.id, input.transactionId),
            inArray(transactions.status, ["confirmed", "adjustment"]),
          ),
        );

      if (current === undefined) {
        // Ou não existe, ou ainda é rascunho de lote proposto — e rascunho se
        // corrige no cartão de conferência da conversa, não aqui.
        return { ok: false as const, error: "Esta transação não está no razão confirmado." };
      }

      if (category !== null) {
        const known = await tx
          .select({ conceptId: concepts.conceptId })
          .from(concepts)
          .where(eq(concepts.type, "Category"));
        const valid = new Set(known.map((row) => row.conceptId.replace(/^categories\//, "")));
        if (!valid.has(category)) {
          return { ok: false as const, error: "Essa categoria não existe na sua taxonomia." };
        }
      }

      const changes: Array<{ field: "category" | "merchant"; from: string | null; to: string | null }> =
        [];
      if (category !== current.category) {
        changes.push({ field: "category", from: current.category, to: category });
      }
      if (merchant !== current.merchant) {
        changes.push({ field: "merchant", from: current.merchant, to: merchant });
      }

      const merchantChanged = changes.some((change) => change.field === "merchant");

      await tx
        .update(transactions)
        .set({
          category,
          merchant,
          // A chave interna acompanha o nome corrigido: sem isso a linha
          // continuaria agrupando pela grafia velha, e a correção não apareceria
          // em recorrência nem em regra aprendida.
          //
          // Só quando o nome muda. Recalcular sempre daria o mesmo valor — a
          // função é determinística sobre o mesmo par — mas gravaria a chave
          // interna em revisões que não mudaram nada, e uma escrita que não
          // precisa existir é uma escrita que um dia se comporta diferente.
          ...(merchantChanged
            ? {
                merchantKey: merchantKey({
                  originalDescription: current.originalDescription,
                  merchant,
                }),
              }
            : {}),
          reviewedAt: new Date(),
          reviewedBy: `human:${userId}`,
        })
        .where(eq(transactions.id, current.id));

      for (const change of changes) {
        await tx.insert(transactionReclassifications).values({
          id: `rcl_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
          tenantId,
          transactionId: current.id,
          field: change.field,
          previousValue: change.from,
          newValue: change.to,
          author: `human:${userId}`,
          reason: reason ?? "Revisão manual",
        });
      }

      return { ok: true as const };
    },
    getDb(),
  );

  if (result.ok) revalidate();
  return result;
}

/**
 * Nomeia a operadora de um documento cujo emissor o extrator não identificou.
 *
 * Fica na revisão porque é a mesma natureza de trabalho: algo que a IA não
 * conseguiu ler. E o efeito é grande — enquanto o documento não tem operadora,
 * TODAS as transações dele caem na linha "Sem operadora" da visão cruzada.
 *
 * O emissor é do documento, não de cada linha, então uma escrita resolve a
 * fatura inteira.
 */
export async function nameDocumentIssuer(input: {
  documentId: string;
  issuer: string;
}): Promise<ActionResult> {
  const context = await getTenantContext();
  if (!context) return { ok: false, error: "Sessão expirada. Entre novamente." };

  const issuer = normalize(input.issuer);
  if (issuer === null) return { ok: false, error: "Escreva o nome da operadora." };
  if (issuer.length > 80) return { ok: false, error: "Nome muito longo para uma operadora." };

  const result = await forTenant(
    context.tenantId,
    async (tx) => {
      const updated = await tx
        .update(documents)
        .set({ issuer })
        .where(eq(documents.id, input.documentId))
        .returning({ id: documents.id });

      return updated.length === 0
        ? { ok: false as const, error: "Documento não encontrado." }
        : { ok: true as const };
    },
    getDb(),
  );

  if (result.ok) revalidate();
  return result;
}

/** Devolve um item à fila — para quando o atestado foi dado por engano. */
export async function reopenReview(input: { transactionId: string }): Promise<ActionResult> {
  const context = await getTenantContext();
  if (!context) return { ok: false, error: "Sessão expirada. Entre novamente." };

  await forTenant(
    context.tenantId,
    async (tx) => {
      await tx
        .update(transactions)
        .set({ reviewedAt: null, reviewedBy: null })
        .where(eq(transactions.id, input.transactionId));
    },
    getDb(),
  );

  revalidate();
  return { ok: true };
}

/**
 * As três telas que leem o razão.
 *
 * `/inicio` entra porque a composição por categoria muda quando um item sai de
 * "sem categoria" — deixá-la em cache mostraria à pessoa o buraco que ela
 * acabou de tapar.
 */
function revalidate() {
  revalidatePath("/revisar");
  revalidatePath("/transacoes");
  revalidatePath("/inicio");
}

function normalize(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
