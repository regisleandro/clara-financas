import { redirect } from "next/navigation";

import { CategoryBreakdown } from "@/components/category-breakdown";
import { loadLedgerView } from "@/lib/ledger";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export default async function TransacoesPage() {
  const context = await getTenantContext();
  if (!context) redirect("/entrar");

  const { rows, total, categories } = await loadLedgerView(context.tenantId);

  return (
    <>
      <section>
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">SEU RAZÃO</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Transações.</h1>
        <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
          Cada número pode ser rastreado até a origem.
        </p>
      </section>

      {rows.length === 0 ? (
        <section className="mt-12 rounded-2xl border border-dashed p-10 text-center">
          <h2 className="text-xl font-semibold tracking-tight">O razão ainda está vazio.</h2>
          <p className="mx-auto mt-2 max-w-md leading-relaxed text-muted-foreground">
            Envie uma fatura pela conversa. Nada é registrado aqui sem a sua aprovação.
          </p>
        </section>
      ) : (
        <>
          <section className="mt-10 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-y py-6">
            <div>
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{brl(total.value)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Lançamentos</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{rows.length}</p>
            </div>
            <p className="ml-auto max-w-xs text-sm leading-relaxed text-muted-foreground">
              O total exclui pagamentos de fatura — eles quitam o ciclo anterior e não são gasto
              deste período.
            </p>
          </section>

          <CategoryBreakdown categories={categories} rows={rows} />
        </>
      )}
    </>
  );
}
