"use client";

/**
 * Tela de boas-vindas da conversa.
 *
 * Os atalhos são CARDS de duas linhas, não pílulas: é o que o design mostra, e
 * a razão é boa — cada atalho carrega um título e uma explicação do que ele
 * faz. `Suggestion` do AI Elements é pílula de uma linha e trunca o segundo
 * texto; usá-la aqui foi o que quebrou a tela. As pílulas ficam onde o design
 * de fato as usa: nos follow-ups depois da resposta.
 */

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
  return (
    <div>
      <h1 className="clara-display-lg text-pretty">
        Oi{name === null ? "" : `, ${name}`}. O que fazemos com o seu dinheiro agora?
      </h1>
      <p className="clara-lead mb-12 mt-6">
        Posso organizar documentos, explicar seus gastos ou cuidar de um compromisso. Os cálculos
        vêm de ferramentas verificáveis e nada é salvo sem sua aprovação.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
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

/** Cabeçalho da conversa: identidade da Clara e saída para nova sessão. */
export function ChatHeader({ onReset }: { onReset: (() => void) | null }) {
  return (
    <header className="mb-12 flex items-center gap-3">
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
      {onReset !== null ? (
        <button
          type="button"
          onClick={onReset}
          className="ml-auto rounded-[var(--clara-radius-pill)] bg-[var(--clara-ash)] px-4 py-2 text-xs"
          style={{ letterSpacing: "-0.022em" }}
        >
          Nova conversa
        </button>
      ) : null}
    </header>
  );
}
