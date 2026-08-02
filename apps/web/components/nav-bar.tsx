"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  activeConversation,
  listConversations,
  setActiveConversation,
  type StoredConversation,
} from "@/lib/session-store";

type NavItem = {
  href: string;
  label: string;
  icon: (props: { className?: string }) => ReactNode;
};

const CORE_ITEMS: NavItem[] = [
  { href: "/conversa", label: "Conversa", icon: ChatIcon },
  { href: "/comparacao", label: "Comparação", icon: CompareIcon },
  { href: "/validacao", label: "Validação", icon: CheckIcon },
];

const SECONDARY_ITEMS: NavItem[] = [
  { href: "/transacoes", label: "Transações", icon: SearchIcon },
  { href: "/aprendizados", label: "Aprendizados", icon: SparkIcon },
  { href: "/agenda", label: "Agenda", icon: CalendarIcon },
];

type ConversationEvent = CustomEvent<{ sessionId: string | null }>;

/**
 * Shell da aplicação. A conversa continua sendo a superfície principal, mas
 * a navegação agora respeita a hierarquia do produto: histórico à esquerda,
 * abas de trabalho no topo e conteúdo no espaço de trabalho.
 */
export function NavBar({
  children,
  hasAlerts = false,
  pendingReview = 0,
  tenantKey = "anon",
  name = null,
}: {
  children: ReactNode;
  hasAlerts?: boolean;
  pendingReview?: number;
  tenantKey?: string;
  name?: string | null;
}) {
  const pathname = usePathname();
  const [railOpen, setRailOpen] = useState(false);
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refreshConversations = () => {
    setConversations(listConversations(tenantKey));
    setActiveId(activeConversation(tenantKey));
  };

  useEffect(() => {
    refreshConversations();

    const onStorage = () => refreshConversations();
    const onUpdated = () => refreshConversations();
    window.addEventListener("storage", onStorage);
    window.addEventListener("clara:conversation-updated", onUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("clara:conversation-updated", onUpdated);
    };
  }, [tenantKey]);

  useEffect(() => {
    setRailOpen(false);
  }, [pathname]);

  /*
   * A aba da área corrente precisa estar À VISTA.
   *
   * Em 360px as seis abas não cabem, e a barra abre sempre no começo: quem
   * estava em Agenda ou Aprendizados via um cabeçalho onde nenhuma aba parecia
   * selecionada — a marca de "onde estou" existia, mas fora da tela. Rolar o
   * mínimo para trazê-la resolve sem mover nada quando ela já está visível
   * (`nearest`), e é por isso que roda também na troca de rota.
   */
  const tabsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const active = tabsRef.current?.querySelector<HTMLElement>(".clara-workspace-tab.is-active");
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  const isActive = (href: string) =>
    pathname === href || (href !== "/conversa" && pathname.startsWith(`${href}/`));

  const firstName = useMemo(() => {
    const clean = name?.trim();
    return clean ? (clean.split(/\s+/)[0] ?? "Você") : "Você";
  }, [name]);

  const openConversation = (sessionId: string | null) => {
    setActiveConversation(tenantKey, sessionId);
    setActiveId(sessionId);
    window.dispatchEvent(
      new CustomEvent<ConversationEvent["detail"]>("clara:open-conversation", {
        detail: { sessionId },
      }),
    );
    setRailOpen(false);
  };

  const conversationDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return "Agora";
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return "Ontem";
    return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" })
      .format(date)
      .replace(" de ", " ");
  };

  const renderWorkspaceTab = (item: NavItem, secondary = false) => {
    const active = isActive(item.href);
    const badge = item.href === "/validacao" ? pendingReview : 0;
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`clara-workspace-tab ${secondary ? "is-secondary" : ""} ${active ? "is-active" : ""}`}
      >
        <Icon className="size-3.5" />
        <span>{item.label}</span>
        {badge > 0 ? (
          <span
            aria-label={`${badge} ${badge === 1 ? "item pendente" : "itens pendentes"}`}
            className="clara-review-badge"
          >
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
        {item.href === "/agenda" && hasAlerts ? (
          <i className="clara-header-alert-dot" aria-label="Avisos novos" />
        ) : null}
      </Link>
    );
  };

  return (
    <div className="clara-app-shell min-h-dvh">
      <button
        type="button"
        aria-label="Fechar menu"
        className={`clara-rail-backdrop ${railOpen ? "is-open" : ""}`}
        onClick={() => setRailOpen(false)}
      />

      <aside className={`clara-rail ${railOpen ? "is-open" : ""}`} aria-label="Navegação da Clara">
        <div className="clara-rail-top">
          <Link
            href="/conversa"
            aria-label="Clara, abrir conversa"
            className="clara-brand"
            onClick={() => setRailOpen(false)}
          >
            <span className="clara-brand-mark">
              <ClaraMark />
            </span>
            <span>clara</span>
          </Link>

          <button
            type="button"
            className="clara-new-conversation"
            onClick={() => openConversation(null)}
          >
            <PlusIcon className="size-4" />
            <span>Nova conversa</span>
          </button>

          <div className="clara-rail-section">
            <p className="clara-rail-label">Conversas</p>
            <div className="clara-conversation-list" role="list">
              {conversations.length === 0 ? (
                <p className="clara-rail-empty">Suas conversas aparecem aqui.</p>
              ) : (
                conversations.slice(0, 8).map((entry) => {
                  const active = activeId === entry.sessionId;
                  return (
                    <button
                      type="button"
                      role="listitem"
                      key={entry.sessionId}
                      className={`clara-conversation-item ${active ? "is-active" : ""}`}
                      onClick={() => openConversation(entry.sessionId)}
                    >
                      {/* Sem `truncate`: o título quebra em até duas linhas
                          (ver `.clara-conversation-item > span`). Numa linha
                          só, toda conversa sobre fatura virava o mesmo prefixo
                          seguido de reticências. */}
                      <span>{entry.title}</span>
                      <time dateTime={new Date(entry.updatedAt).toISOString()}>
                        {conversationDate(entry.updatedAt)}
                      </time>
                    </button>
                  );
                })
              )}
            </div>
          </div>

        </div>

        <div className="clara-rail-bottom">
          <div className="clara-profile">
            <span className="clara-profile-avatar" aria-hidden="true">
              {firstName === "Você" ? "VC" : firstName.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{name ?? "Você"}</strong>
              <small>Conta pessoal</small>
            </div>
          </div>
        </div>
      </aside>

      <section className="clara-workspace">
        <header className="clara-workspace-header">
          <button
            type="button"
            className="clara-mobile-menu"
            aria-label="Abrir menu"
            aria-expanded={railOpen}
            onClick={() => setRailOpen(true)}
          >
            <MenuIcon className="size-5" />
          </button>
          <nav ref={tabsRef} className="clara-workspace-tabs" aria-label="Áreas principais">
            {CORE_ITEMS.map((item) => renderWorkspaceTab(item))}
            <span className="clara-workspace-tab-divider" aria-hidden="true" />
            {SECONDARY_ITEMS.map((item) => renderWorkspaceTab(item, true))}
          </nav>
          <div className="clara-workspace-tools">
            <Link href="/transacoes" aria-label="Buscar transação" className="clara-tool-button">
              <SearchIcon className="size-4" />
            </Link>
          </div>
        </header>
        <main className="clara-workspace-main">{children}</main>
      </section>
    </div>
  );
}

function ClaraMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M15.4 6.6a6.3 6.3 0 1 0 0 6.8" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="10" cy="10" r="2" fill="currentColor" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>;
}

function MenuIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M3 5.5h14M3 10h14M3 14.5h14" /></svg>;
}

function ChatIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v4a2.5 2.5 0 0 1-2.5 2.5H9l-3.5 3v-3.1A2.5 2.5 0 0 1 4 9.5v-4Z" /></svg>;
}

function CompareIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M5 4v12M15 4v12M3 7h4M13 13h4" /><path d="m6.8 5.2 2-1.2 2 1.2M13.2 14.8l-2 1.2-2-1.2" /></svg>;
}

function CheckIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 10.2 3.8 3.8L16 5.8" /></svg>;
}

function SearchIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="8.6" cy="8.6" r="5.2" /><path d="m12.5 12.5 4 4" /></svg>;
}

function SparkIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m10 2 1.2 4.8L16 8l-4.8 1.2L10 14l-1.2-4.8L4 8l4.8-1.2L10 2Z" /><path d="m16.2 13.2.5 2 .3.1-2 .5-.1.2-.5-2-.2-.1 2-.5Z" /></svg>;
}

function CalendarIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12" rx="2.5" /><path d="M3 8h14M6.5 2.8v3M13.5 2.8v3" /></svg>;
}
