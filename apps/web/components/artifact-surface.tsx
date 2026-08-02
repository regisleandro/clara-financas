"use client";

import type { View } from "@clara-financas/views";
import type { FinancialArtifact } from "@clara-financas/views";
import { PanelRightOpen } from "lucide-react";

import { ArtifactPanelInner, type ArtifactData } from "@/components/artifact-panel";
import { ViewPanelInner } from "@/components/view-panel";
import { FinancialArtifactPanelInner } from "@/components/financial-artifact-panel";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * A superfície de Detalhes, em duas molduras a partir do MESMO conteúdo.
 *
 * Detalhes é consultado enquanto se decide, então precisa ficar visível ao
 * lado da conversa — no desktop, uma coluna fixa à direita. No celular não há
 * "ao lado": a tela é estreita e a coluna sumia por completo (`hidden lg:block`
 * cobria os dois painéis), deixando quem usa no telefone sem acesso a Detalhes.
 * A resposta é uma modal em tela cheia, aberta pelo link que acompanha a
 * resposta que o produziu.
 */

export type ActiveArtifact =
  | { kind: "batch"; data: ArtifactData }
  | { kind: "financial"; artifacts: FinancialArtifact[] }
  /**
   * Os painéis do turno, em ordem. É lista, e não um só, porque a Clara pode
   * desenhar mais de um na mesma resposta — a proposta e o resultado, a
   * conferência e a composição. O último é o que aparece; os anteriores
   * continuam alcançáveis em vez de sumirem sem sinal.
   */
  | { kind: "view"; views: View[] };

function ArtifactBody({
  active,
  onClose,
}: {
  active: ActiveArtifact;
  onClose: () => void;
}) {
  return active.kind === "batch" ? (
    <ArtifactPanelInner data={active.data} onClose={onClose} />
  ) : active.kind === "financial" ? (
    <FinancialArtifactPanelInner artifacts={active.artifacts} onClose={onClose} />
  ) : (
    <ViewPanelInner views={active.views} onClose={onClose} />
  );
}

const titleOf = (active: ActiveArtifact) =>
  active.kind === "batch"
    ? active.data.title
    : active.kind === "financial"
      ? (active.artifacts.at(-1)?.title ?? "Detalhes financeiros")
      : (active.views.at(-1)?.title ?? "Detalhes");

/** Coluna fixa à direita — só a partir de `lg`. */
export function ArtifactAside({
  active,
  onClose,
}: {
  active: ActiveArtifact;
  onClose: () => void;
}) {
  return (
    <aside
      // Sem largura própria: quem a define é a faixa do grid em
      // `.clara-chat-layout.with-details`. A classe anterior era
      // `w-[min(42vw,560px)] shrink-0` — 42% do VIEWPORT, enquanto a coluna de
      // conversa media 58% do CONTAINER (que já descontava o rail). Duas bases
      // diferentes, ambas inencolhíveis, 97,44px sobrando entre 1024 e 1333px.
      className="clara-details-panel hidden overflow-y-auto border-l border-[var(--clara-border)] lg:block"
      style={{
        height: "calc(100dvh - var(--clara-nav-height))",
        position: "sticky",
        top: "var(--clara-nav-height)",
        animation: "clara-slidein 0.28s ease",
      }}
      aria-label="Detalhes"
    >
      <ArtifactBody active={active} onClose={onClose} />
    </aside>
  );
}

/**
 * Modal em tela cheia — a moldura do celular.
 *
 * Quem controla se está aberta é o `Chat`, que só liga `open` abaixo de `lg`
 * (via `useMediaQuery`). Assim a modal nunca trava a rolagem por baixo do painel
 * fixo no desktop, mesmo com o conteúdo escondido por CSS.
 */
export function ArtifactModal({
  active,
  open,
  onOpenChange,
}: {
  active: ActiveArtifact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto rounded-none border-0 bg-[var(--clara-white)] p-0 sm:max-w-none lg:hidden"
      >
        {/* Título exigido pelo Radix para leitores de tela; o visível vem do
            cabeçalho do próprio conteúdo. */}
        <DialogTitle className="sr-only">{active ? titleOf(active) : "Detalhes"}</DialogTitle>
        {active ? (
          <ArtifactBody active={active} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * O link que ACOMPANHA a resposta: aparece só nas mensagens que têm Detalhes
 * associado, e é o único caminho para Detalhes no celular. Abre a coluna à
 * direita na web e a modal no telefone — a decisão de qual é do `Chat`.
 */
export function ArtifactLink({
  onOpen,
  label = "Ver detalhes",
  title,
  meta,
}: {
  onOpen: () => void;
  label?: string;
  title?: string;
  meta?: string;
}) {
  const action = label.replace(/[↗→]\s*$/u, "").trim();
  const fallbackTitle = action.replace(/^ver\s+/i, "");
  return (
    <button
      type="button"
      onClick={onOpen}
      className="clara-details-link"
    >
      <span className="clara-details-link-icon" aria-hidden="true">
        <PanelRightOpen className="size-4" />
      </span>
      <span className="clara-details-link-copy">
        <small>Detalhes</small>
        <strong>{title ?? fallbackTitle}</strong>
        <em>{meta ?? "Confira a origem e os números desta resposta"}</em>
      </span>
      <span className="clara-details-link-action">{action} ↗</span>
    </button>
  );
}
