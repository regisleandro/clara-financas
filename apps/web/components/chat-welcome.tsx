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
