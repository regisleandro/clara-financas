import { redirect } from "next/navigation";

import { NavBar } from "@/components/nav-bar";
import { hasUnreadAlerts } from "@/lib/agenda";
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

  const alerts = await hasUnreadAlerts(context.tenantId);

  return (
    <div className="min-h-svh bg-background">
      <NavBar hasAlerts={alerts} />
      {/* pt-12 compensa a barra fixa; o padding inferior generoso é do design
          — as telas terminam com ar, não com o rodapé colado no conteúdo. */}
      <main className="pt-12">{children}</main>
    </div>
  );
}
