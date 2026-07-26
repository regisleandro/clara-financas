import Link from "next/link";
import { redirect } from "next/navigation";

import { ReviewQueue } from "@/components/review-queue";
import { loadReviewQueue } from "@/lib/review";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * A tela do trabalho que a IA não conseguiu fechar.
 *
 * O título diz "revisar", não "erros": confiança baixa não é erro, é o extrator
 * sendo honesto sobre a própria leitura. Tratar as duas coisas com a mesma
 * palavra ensinaria a pessoa a desconfiar do razão inteiro.
 */
export default async function RevisarPage() {
  const context = await getTenantContext();
  if (!context) redirect("/entrar");

  const queue = await loadReviewQueue(context.tenantId);
  const pending = queue.items.length;

  return (
    <div className="clara-shell pb-40 pt-12">
      <header className="flex flex-wrap items-end justify-between gap-10 py-16 sm:py-24">
        <div>
          <p className="clara-eyebrow mb-5">Revisão manual</p>
          <h1 className="clara-hero">
            {pending === 0 ? "Nada pendente." : `${pending} para conferir.`}
          </h1>
          <p className="clara-lead mt-3 max-w-[36ch]">
            {pending === 0
              ? "Quando a Clara não tiver certeza de uma leitura, ela aparece aqui."
              : "A Clara leu, mas não fechou. Você decide, e a decisão fica registrada."}
          </p>
        </div>
        <div className="flex items-center gap-5 pb-2.5">
          <Link href="/transacoes" className="clara-link">
            Ver o razão ›
          </Link>
          <Link href="/conversa" className="clara-pill clara-pill-primary">
            Conversar com a Clara
          </Link>
        </div>
      </header>

      <ReviewQueue queue={queue} />

      <p className="clara-small mt-6 max-w-[60ch]">
        Categoria e comerciante são leitura e podem mudar — cada mudança entra na trilha de
        auditoria com o seu nome. Valor, data, descrição e origem vieram do documento e não se
        editam: correção de valor é uma linha de ajuste, feita pela conversa.
      </p>
    </div>
  );
}
