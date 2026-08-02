import { redirect } from "next/navigation";

import { NavBar } from "@/components/nav-bar";
import { hasUnreadAlerts } from "@/lib/agenda";
import { countPendingReview } from "@/lib/review";
import { getTenantContext } from "@/lib/tenant";

/**
 * Guard das superfícies protegidas.
 *
 * Confere DUAS coisas, não uma: sessão válida E espaço pronto. É o segundo
 * teste que impede a pessoa de cair num app vazio enquanto o provisionamento
 * ainda roda — e o motivo de /preparando existir desde a Etapa 0, mesmo com
 * provisionamento instantâneo no modo pool.
 *
 * Renderizado no servidor, então nenhum conteúdo protegido chega ao navegador
 * antes da decisão.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await getTenantContext();

  if (!context) redirect("/entrar");
  if (context.status !== "ready") redirect("/preparando");

  const [alerts, pendingReview] = await Promise.all([
    hasUnreadAlerts(context.tenantId),
    countPendingReview(context.tenantId),
  ]);

  return (
    <NavBar
      hasAlerts={alerts}
      pendingReview={pendingReview}
      tenantKey={context.tenantId}
      name={context.name}
    >
      {children}
    </NavBar>
  );
}
