"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Barra fixa do topo.
 *
 * Escura e translúcida sobre fundo claro — a inversão é o que faz a barra
 * "flutuar" em vez de dividir a página. O `backdrop-filter` com saturação
 * acima de 100% é o detalhe que dá o vidro da linguagem Apple: sem ele o
 * conteúdo por baixo aparece lavado.
 *
 * 48px de altura, sem exceção: é a âncora vertical de todas as telas.
 */

const ITEMS = [
  { href: "/conversa", label: "Conversa" },
  { href: "/inicio", label: "Visão geral" },
  { href: "/transacoes", label: "Transações" },
  { href: "/revisar", label: "Revisar" },
  { href: "/aprendizados", label: "Aprendizados" },
  { href: "/agenda", label: "Agenda" },
];

export function NavBar({
  hasAlerts = false,
  pendingReview = 0,
}: {
  hasAlerts?: boolean;
  /**
   * A contagem fica ao lado do rótulo, não num ponto vermelho: "3" diz o
   * tamanho do trabalho, e um ponto só diz que existe trabalho — o que faz a
   * pessoa abrir a tela para descobrir.
   */
  pendingReview?: number;
}) {
  const pathname = usePathname();

  return (
    <header
      className="fixed inset-x-0 top-0 z-50 h-12"
      style={{
        background: "var(--clara-nav-bg)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
      }}
    >
      <nav className="mx-auto flex h-12 max-w-[1024px] items-center gap-1 px-2.5">
        <Link href="/inicio" className="flex items-center gap-2 pr-3.5">
          <span className="grid size-[18px] shrink-0 place-items-center rounded-md bg-[var(--clara-fog)]">
            <ClaraMark />
          </span>
          <span
            className="text-sm font-semibold text-[var(--clara-fog)]"
            style={{ fontFamily: "var(--clara-display)", letterSpacing: "-0.015em" }}
          >
            clara
          </span>
        </Link>

        <ul className="flex items-center overflow-x-auto">
          {ITEMS.map((item) => {
            const active = pathname === item.href;
            const badge = item.href === "/revisar" ? pendingReview : 0;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className="flex h-12 items-center gap-1.5 whitespace-nowrap px-[11px] text-xs text-[var(--clara-fog)] transition-opacity hover:opacity-100"
                  style={{ letterSpacing: "-0.01em", opacity: active ? 1 : 0.72 }}
                >
                  {item.label}
                  {badge > 0 ? (
                    <span
                      aria-label={`${badge} ${badge === 1 ? "item pendente" : "itens pendentes"}`}
                      className="grid h-[17px] min-w-[17px] place-items-center rounded-full bg-[var(--clara-blue)] px-1 text-[10px] font-semibold text-white"
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/transacoes"
            aria-label="Buscar transação"
            className="grid size-[30px] place-items-center rounded-full transition-colors hover:bg-white/15"
          >
            <SearchIcon />
          </Link>
          <Link
            href="/agenda"
            aria-label={hasAlerts ? "Agenda, com avisos novos" : "Agenda"}
            className="relative grid size-[30px] place-items-center rounded-full transition-colors hover:bg-white/15"
          >
            <CalendarIcon />
            {hasAlerts ? (
              <span
                aria-hidden="true"
                className="absolute right-1 top-1 size-[5px] rounded-full bg-[var(--clara-blue)]"
              />
            ) : null}
          </Link>
        </div>
      </nav>
    </header>
  );
}

function ClaraMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.7" fill="none" stroke="#1d1d1f" strokeWidth="1.3" />
      <circle cx="6" cy="6" r="1.7" fill="#1d1d1f" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="#f5f5f7"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="6.9" cy="6.9" r="4.7" />
      <path d="M10.4 10.4 13.9 13.9" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="#f5f5f7"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="2.3" y="3.5" width="11.4" height="10.2" rx="2.4" />
      <path d="M2.3 6.7h11.4M5.6 2.3v2.1M10.4 2.3v2.1" />
    </svg>
  );
}
