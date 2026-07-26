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
  // O array de starters chega ORDENADO por urgência do servidor: a nota do
  // primeiro é a frase que abre a conversa do que é verdade — vencimento
  // próximo, conferência aberta — em vez de uma saudação genérica.
  const urgentNote = starters[0]?.prompt !== null ? starters[0]?.note : undefined;

  return (
    <div>
      <h1 className="clara-display-lg text-pretty">
        Oi{name === null ? "" : `, ${name}`}. O que fazemos com o seu dinheiro agora?
      </h1>
      {urgentNote !== undefined ? (
        <p className="clara-small mt-4 text-[var(--clara-graphite)]">{urgentNote}</p>
      ) : null}
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {starters.map((starter) => (
          <button
            key={starter.title}
            type="button"
            disabled={disabled}
            onClick={() => onPick(starter)}
            className="clara-card flex flex-col gap-2 p-7 text-left transition-colors hover:bg-[#fbfbfd] disabled:opacity-60"
          >
            <strong className="clara-display-xs">{starter.title}</strong>
            <small className="clara-small">{starter.note}</small>
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

/** Cabeçalho da conversa: identidade da Clara, histórico, artefato e sessão. */
export function ChatHeader({
  onReset,
  onToggleArtifact,
  artifactOpen,
  conversations,
  activeSessionId,
  onSelectConversation,
}: {
  onReset: (() => void) | null;
  onToggleArtifact?: (() => void) | null;
  artifactOpen?: boolean;
  /** Conversas guardadas neste dispositivo, mais recente primeiro. */
  conversations?: readonly ConversationEntry[];
  activeSessionId?: string;
  onSelectConversation?: (sessionId: string) => void;
}) {
  const history = (conversations ?? []).filter(
    (entry) => entry.sessionId !== activeSessionId,
  );

  return (
    <header className="flex items-center gap-3">
      <span className="grid size-[31px] shrink-0 place-items-center rounded-[10px] bg-[var(--clara-ink)]">
        <svg width="19" height="19" viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="6" cy="6" r="4.7" fill="none" stroke="#f5f5f7" strokeWidth="1.2" />
          <circle cx="6" cy="6" r="1.7" fill="#f5f5f7" />
        </svg>
      </span>
      <span>
        <strong className="clara-display-xs block">Clara</strong>
        <small className="clara-small block">Assistente financeiro · sessão ativa</small>
      </span>
      <span className="ml-auto flex items-center gap-2.5">
        {history.length > 0 && onSelectConversation !== undefined ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="clara-pill clara-pill-outline h-8 px-4 text-xs">
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
            {artifactOpen ? "Fechar artefato" : "Ver artefato"}
          </button>
        ) : null}
        {onReset !== null ? (
          <button
            type="button"
            onClick={onReset}
            className="rounded-[var(--clara-radius-pill)] bg-[var(--clara-ash)] px-4 py-2 text-xs"
            style={{ letterSpacing: "-0.022em" }}
          >
            Nova conversa
          </button>
        ) : null}
      </span>
    </header>
  );
}
