import Link from "next/link";
import { redirect } from "next/navigation";

import { TransactionTable } from "@/components/transaction-table";
import { loadLedgerView } from "@/lib/ledger";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function TransacoesPage() {
  const context = await getTenantContext();
  if (!context) redirect("/entrar");

  const { rows, categories } = await loadLedgerView(context.tenantId);

  return (
    <div className="clara-shell pb-40 pt-12">
      <header className="flex flex-wrap items-end justify-between gap-10 py-16 sm:py-24">
        <div>
          <p className="clara-eyebrow mb-5">Seu razão</p>
          <h1 className="clara-hero">Transações.</h1>
          <p className="clara-lead mt-3 max-w-[32ch]">
            Cada número pode ser rastreado até a origem.
          </p>
        </div>
        <Link href="/conversa" className="clara-pill clara-pill-primary mb-2.5">
          Importar fatura
        </Link>
      </header>

      <TransactionTable
        rows={rows.map((row) => ({
          id: row.id,
          merchant: row.merchant ?? row.originalDescription,
          date: row.date,
          category: row.category,
          confidence: row.extractionConfidence,
          amount: row.amount,
          source: row.documentIssuer ?? row.documentFilename ?? "documento",
          page: row.page,
          isAdjustment: row.status === "adjustment",
        }))}
        categories={categories
          .map((bucket) => bucket.category)
          .filter((category): category is string => category !== null)}
      />
    </div>
  );
}
