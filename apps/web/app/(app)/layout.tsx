import Link from "next/link";
import { redirect } from "next/navigation";

import { getTenantContext } from "@/lib/tenant";

const NAV = [
  { href: "/inicio", label: "Início" },
  { href: "/conversa", label: "Conversa" },
  { href: "/transacoes", label: "Transações" },
  { href: "/aprendizados", label: "Aprendizados" },
  { href: "/agenda", label: "Agenda" },
];

/**
 * Guard das superfícies protegidas.
 *
 * Confere DUAS coisas, não uma: sessão válida E espaço pronto. É o segundo
 * teste que impede o usuário de cair num app vazio enquanto o provisionamento
 * ainda roda — e o motivo de a tela /preparando existir desde a Etapa 0,
 * mesmo com provisionamento instantâneo no modo pool.
 *
 * Renderizado no servidor, então nenhum conteúdo protegido chega ao navegador
 * antes da decisão.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await getTenantContext();

  if (!context) redirect("/entrar");
  if (context.status !== "ready") redirect("/preparando");

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-5xl flex-col px-6">
      <header className="flex items-center justify-between gap-6 border-b py-4">
        <Link href="/inicio" className="text-lg font-semibold tracking-tight">
          Clara
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="flex-1 py-10">{children}</main>
    </div>
  );
}
