"use client";

import {
  Artifact,
  ArtifactActions,
  ArtifactClose,
  ArtifactContent,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";

/**
 * Painel lateral de artefato.
 *
 * No protótipo o artefato NÃO fica dentro da conversa — ele abre à direita,
 * fixo, e a conversa continua ao lado. A diferença não é estética: o artefato
 * é consultado enquanto se decide, então precisa estar visível ao mesmo tempo
 * que a pergunta e a resposta. Embutido no fluxo, ele rola para fora da tela
 * exatamente quando é mais necessário.
 */

export type ArtifactRow = { label: string; note?: string; value: string; emphasis?: boolean };

export type ArtifactData = {
  title: string;
  metricLabel: string;
  metric: string;
  note?: string;
  listTitle: string;
  rows: ArtifactRow[];
  footnote?: string;
  primaryAction?: { label: string; onClick: () => void; disabled?: boolean };
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
};

/**
 * O conteúdo do artefato, sem a moldura.
 *
 * Separado do `<aside>` de propósito: a mesma composição é fixada à direita na
 * web e aberta como modal em tela cheia no celular. A moldura é escolhida por
 * quem renderiza (`Chat`), conforme o tamanho da tela.
 */
export function ArtifactPanelInner({
  data,
  onClose,
}: {
  data: ArtifactData;
  onClose: () => void;
}) {
  return (
    <Artifact className="h-full rounded-none border-0 bg-transparent">
        <ArtifactHeader className="items-start border-0 px-7 pb-5 pt-7">
          <div>
            <p className="clara-eyebrow">Artefato</p>
            <ArtifactTitle className="clara-display-sm mt-1.5 text-foreground">
              {data.title}
            </ArtifactTitle>
          </div>
          <ArtifactActions>
            <ArtifactClose onClick={onClose} />
          </ArtifactActions>
        </ArtifactHeader>

        <ArtifactContent className="px-7 pb-14">
          {/* O número é o herói do painel: cartão próprio, tipografia grande. */}
          <div className="rounded-[var(--clara-radius-card)] bg-[var(--clara-fog)] p-7">
            <p className="clara-eyebrow">{data.metricLabel}</p>
            <p className="clara-metric mt-3.5">{data.metric}</p>
            {data.note !== undefined ? (
              <p className="mt-1.5 text-[var(--clara-graphite)]">{data.note}</p>
            ) : null}
          </div>

          <h4 className="clara-display-xs mb-1 mt-10">{data.listTitle}</h4>
          <ul>
            {data.rows.map((row) => (
              <li
                key={row.label}
                className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-[var(--clara-fog)] py-4 last:border-0"
              >
                <span className="min-w-0">
                  <strong className="block truncate font-semibold">{row.label}</strong>
                  {row.note !== undefined && row.note !== "" ? (
                    <small className="clara-small mt-[3px] block">{row.note}</small>
                  ) : null}
                </span>
                <span
                  className={
                    row.emphasis
                      ? "tabular-nums text-[var(--clara-amber)]"
                      : "tabular-nums"
                  }
                >
                  {row.value}
                </span>
              </li>
            ))}
          </ul>

          {data.primaryAction !== undefined || data.secondaryAction !== undefined ? (
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {data.primaryAction !== undefined ? (
                <button
                  type="button"
                  onClick={data.primaryAction.onClick}
                  disabled={data.primaryAction.disabled}
                  className="clara-pill clara-pill-primary disabled:opacity-40"
                >
                  {data.primaryAction.label}
                </button>
              ) : null}
              {data.secondaryAction !== undefined ? (
                <button
                  type="button"
                  onClick={data.secondaryAction.onClick}
                  disabled={data.secondaryAction.disabled}
                  className="clara-link disabled:opacity-40"
                >
                  {data.secondaryAction.label}
                </button>
              ) : null}
            </div>
          ) : null}

          {data.footnote !== undefined ? (
            <p className="clara-small mt-5">{data.footnote}</p>
          ) : null}
        </ArtifactContent>
      </Artifact>
  );
}
