"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Tela de boas-vindas da conversa.
 *
 * Os atalhos são CARDS de duas linhas, não pílulas: é o que o design mostra, e
 * a razão é boa — cada atalho carrega um título e uma explicação do que ele
 * faz. `Suggestion` do AI Elements é pílula de uma linha e trunca o segundo
 * texto; usá-la aqui foi o que quebrou a tela. As pílulas ficam onde o design
 * de fato as usa: nos follow-ups depois da resposta.
 */

export type ConversationEntry = {
  sessionId: string;
  title: string;
  updatedAt: number;
};

export type Starter = {
  title: string;
  note: string;
  /** `null` abre o seletor de arquivo em vez de enviar mensagem. */
  prompt: string | null;
};

export function ChatWelcome({
  name,
  starters,
  disabled,
  onPick,
}: {
  name: string | null;
  starters: readonly Starter[];
  disabled: boolean;
  onPick: (starter: Starter) => void;
}) {
  const defaults: readonly Starter[] = [
    {
      title: "Ver a divergência",
      note: "A soma de uma fatura não fecha",
      prompt: "Verifique a divergência da minha última fatura.",
    },
    {
      title: "Comparar as duas últimas faturas",
      note: "Entender o que mudou de um ciclo para o outro",
      prompt: "Compare minhas duas últimas faturas.",
    },
    {
      title: "Ver onde foi o dinheiro",
      note: "Composição da fatura mais recente",
      prompt: "Mostre onde foi o dinheiro da minha última fatura.",
    },
    {
      title: "Enviar um documento",
      note: "Fatura, extrato ou nota fiscal em PDF",
      prompt: null,
    },
  ];
  const visibleStarters = defaults.map((fallback, index) => starters[index] ?? fallback);

  return (
    <div className="clara-welcome">
      <p className="clara-eyebrow">Assistente financeiro</p>
      <h1 className="clara-welcome-title">
        Seu dinheiro, <span className="clara-highlight">bem explicado.</span>
      </h1>
      <div className="clara-welcome-intro">
        <span className="clara-message-mark" aria-hidden="true">c.</span>
        <p>
          Oi{name === null ? "" : `, ${name}`}. Eu organizo seus dados, explico o que mudou e mostro os detalhes para você decidir.
        </p>
      </div>
      <div className="clara-quick-list" aria-label="Comece por aqui">
        {visibleStarters.map((starter, index) => (
          <button
            key={starter.title}
            type="button"
            disabled={disabled}
            onClick={() => onPick(starter)}
            className="clara-quick-row disabled:opacity-60"
          >
            <span className={`clara-quick-icon clara-quick-icon-${index + 1}`} aria-hidden="true">
              {index === 3 ? "↑" : index === 1 ? "↔" : index === 2 ? "◒" : "!"}
            </span>
            <span className="clara-quick-copy">
              <strong>{starter.title}</strong>
              <small>{starter.note}</small>
            </span>
            <span className="clara-quick-arrow" aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Data curta para o menu de conversas. */
const conversationDate = (timestamp: number) =>
  new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" }).format(
    new Date(timestamp),
  );

/** Cabeçalho da conversa: identidade da Clara, histórico, Detalhes e sessão. */
export function ChatHeader({
  onReset,
  onToggleArtifact,
  artifactOpen,
  conversations,
  activeSessionId,
  onSelectConversation,
  navigationDisabled = false,
}: {
  onReset: (() => void) | null;
  onToggleArtifact?: (() => void) | null;
  artifactOpen?: boolean;
  /** Conversas guardadas neste dispositivo, mais recente primeiro. */
  conversations?: readonly ConversationEntry[];
  activeSessionId?: string;
  onSelectConversation?: (sessionId: string) => void;
  /** Evita abandonar uma sessão enquanto um turno ou decisão está em voo. */
  navigationDisabled?: boolean;
}) {
  const history = (conversations ?? []).filter(
    (entry) => entry.sessionId !== activeSessionId,
  );

  return (
    <header className="flex items-center gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--clara-yellow)] text-[var(--clara-ink)]">
        <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M15.4 6.6a6.3 6.3 0 1 0 0 6.8" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
          <circle cx="10" cy="10" r="2" fill="currentColor" />
        </svg>
      </span>
      <span>
        <strong className="clara-display-xs block">Clara</strong>
        <small className="clara-small block">Assistente financeiro · sessão ativa</small>
      </span>
      <span className="ml-auto flex items-center gap-2.5">
        {history.length > 0 && onSelectConversation !== undefined ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={navigationDisabled}
              className="clara-pill clara-pill-outline h-8 px-4 text-xs disabled:opacity-50"
            >
              Conversas
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-72">
              {history.map((entry) => (
                <DropdownMenuItem
                  key={entry.sessionId}
                  onSelect={() => onSelectConversation(entry.sessionId)}
                  className="flex-col items-start gap-0.5"
                >
                  <span className="w-full truncate text-sm">{entry.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {conversationDate(entry.updatedAt)}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {onToggleArtifact ? (
          <button
            type="button"
            onClick={onToggleArtifact}
            className="clara-pill clara-pill-outline h-8 px-4 text-xs"
          >
            {artifactOpen ? "Fechar detalhes" : "Ver detalhes"}
          </button>
        ) : null}
        {onReset !== null ? (
          <button
            type="button"
            onClick={onReset}
            disabled={navigationDisabled}
            className="clara-pill clara-pill-outline min-h-8 px-3 text-xs disabled:opacity-50"
            style={{ letterSpacing: "-0.022em" }}
          >
            Nova conversa
          </button>
        ) : null}
      </span>
    </header>
  );
}
