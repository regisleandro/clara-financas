import { getDb } from "@clara-financas/db";
import { agentSessions } from "@clara-financas/db/schema/agent-session";
import { batches, documents } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { latestInvoiceOrder } from "./invoice-order";
import { formatDocumentLabel } from "@clara-financas/ledger";
import { and, eq, inArray, sql } from "drizzle-orm";

export const INVOICE_REFERENCES = ["active", "latest", "next_with_divergence"] as const;
export type InvoiceReference = (typeof INVOICE_REFERENCES)[number];

type InvoiceFocus = {
  batchId: string;
  documentId: string;
  issuer: string | null;
  documentKind: "unknown" | "credit_card_invoice" | "bank_statement" | "invoice_nfe";
  invoiceLabel: string;
  status: "proposed" | "confirmed";
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  checksumResult: string | null;
};

/**
 * Faz uma fatura virar o sujeito explícito da conversa.
 *
 * A linha de sessão já foi criada e teve a posse validada pelo canal do Eve.
 * Atualizar zero linhas é erro: sem sessão persistida, fingir que o foco foi
 * guardado devolveria a ambiguidade que esta camada existe para eliminar.
 */
export async function setInvoiceFocus(
  tenantId: string,
  sessionId: string,
  batchId: string,
): Promise<boolean> {
  return forTenant(
    tenantId,
    async (tx) => {
      const changed = await tx
        .update(agentSessions)
        .set({ activeBatchId: batchId, focusUpdatedAt: sql`now()` })
        .where(
          and(
            eq(agentSessions.tenantId, tenantId),
            eq(agentSessions.sessionId, sessionId),
          ),
        )
        .returning({ sessionId: agentSessions.sessionId });
      return changed.length === 1;
    },
    getDb(),
  );
}

/**
 * Resolve palavras relacionais por uma ordem única e testável.
 *
 * - active: a fatura que foi aberta/proposta nesta sessão;
 * - latest: a mais nova pelo fim do ciclo, depois criação e id;
 * - next_with_divergence: a primeira divergente DEPOIS da ativa nessa mesma
 *   ordem. Sem foco anterior, começa na primeira divergente.
 */
export async function resolveInvoiceFocus(
  tenantId: string,
  sessionId: string,
  reference: InvoiceReference,
): Promise<InvoiceFocus | null> {
  return forTenant(
    tenantId,
    async (tx) => {
      const [session] = await tx
        .select({ activeBatchId: agentSessions.activeBatchId })
        .from(agentSessions)
        .where(
          and(
            eq(agentSessions.tenantId, tenantId),
            eq(agentSessions.sessionId, sessionId),
          ),
        )
        .limit(1);
      if (session === undefined) return null;

      const invoices = await tx
        .select({
          batchId: batches.id,
          documentId: batches.documentId,
          issuer: documents.issuer,
          documentKind: documents.kind,
          status: batches.status,
          periodStart: batches.periodStart,
          periodEnd: batches.periodEnd,
          dueDate: batches.dueDate,
          checksumResult: batches.checksumResult,
        })
        .from(batches)
        .innerJoin(documents, eq(documents.id, batches.documentId))
        .where(inArray(batches.status, ["proposed", "confirmed"]))
        .orderBy(...latestInvoiceOrder());

      let selected: (typeof invoices)[number] | undefined;
      if (reference === "active") {
        selected = invoices.find((invoice) => invoice.batchId === session.activeBatchId);
      } else if (reference === "latest") {
        /*
         * "A última FATURA" é uma fatura.
         *
         * A consulta traz todo documento com lote, e `latest` pegava o primeiro
         * da lista sem olhar o tipo — então quem tivesse enviado um extrato
         * bancário ou uma nota fiscal depois da última fatura recebia esse
         * documento como resposta a "compare com a última fatura". O tipo já
         * viajava no resultado (`documentKind`) e simplesmente não era
         * consultado.
         *
         * A queda para qualquer documento existe porque um razão que só tem
         * extratos ainda precisa responder "o último" — devolver nada ali seria
         * pior que devolver o que há. `active` e `next_with_divergence` não
         * filtram: quem já está em foco é o que a pessoa apontou, seja qual for
         * o tipo.
         */
        selected =
          invoices.find((invoice) => invoice.documentKind === "credit_card_invoice") ??
          invoices[0];
      } else {
        const activeIndex = invoices.findIndex(
          (invoice) => invoice.batchId === session.activeBatchId,
        );
        selected = invoices
          .slice(activeIndex < 0 ? 0 : activeIndex + 1)
          .find((invoice) => invoice.checksumResult === "mismatch");
      }

      if (selected === undefined) return null;

      await tx
        .update(agentSessions)
        .set({ activeBatchId: selected.batchId, focusUpdatedAt: sql`now()` })
        .where(eq(agentSessions.sessionId, sessionId));

      return {
        ...selected,
        invoiceLabel: formatDocumentLabel(selected),
        status: selected.status as InvoiceFocus["status"],
      };
    },
    getDb(),
  );
}
