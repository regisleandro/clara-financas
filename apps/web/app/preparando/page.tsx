import Link from "next/link";
import { redirect } from "next/navigation";

import { getProvisioningJob, getTenantContext } from "@/lib/tenant";

/**
 * Espera do provisionamento.
 *
 * Fica deliberadamente FORA do grupo (app): é para cá que o guard manda quem
 * ainda não tem espaço pronto, então herdar esse guard criaria um laço de
 * redirecionamento.
 *
 * Tela honesta — mostra estado e dá saída em caso de falha, em vez de um
 * spinner mudo que deixa o usuário preso.
 */
export const dynamic = "force-dynamic";

export default async function PreparandoPage() {
  const context = await getTenantContext();
  if (!context) redirect("/entrar");
  if (context.status === "ready") redirect("/inicio");

  const job = await getProvisioningJob(context.tenantId);
  const failed = context.status === "failed" || job?.status === "failed";

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-6 py-16">
      {failed ? (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">
            Não conseguimos preparar seu espaço.
          </h1>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            Nada do que é seu foi perdido — o espaço apenas não terminou de ser criado. Podemos
            tentar de novo.
          </p>
          {job?.lastError ? (
            <p className="mt-4 rounded-lg bg-muted px-4 py-3 font-mono text-xs text-muted-foreground">
              {job.lastError}
            </p>
          ) : null}
          <Link
            href="/inicio"
            className="mt-8 inline-flex h-12 w-fit items-center justify-center rounded-full bg-primary px-7 text-[15px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Tentar de novo
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">Preparando seu espaço.</h1>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            Estamos criando um lugar só seu para guardar suas finanças. Leva cerca de um minuto —
            pode deixar esta página aberta.
          </p>
          <meta httpEquiv="refresh" content="5" />
        </>
      )}
    </main>
  );
}
