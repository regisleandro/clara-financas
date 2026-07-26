"use client";

import type { View } from "@clara-financas/views";
import { PanelRightOpen } from "lucide-react";

import { ArtifactPanelInner, type ArtifactData } from "@/components/artifact-panel";
import { ViewPanelInner } from "@/components/view-panel";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * A superfície do artefato, em duas molduras a partir do MESMO conteúdo.
 *
 * O artefato é consultado enquanto se decide, então precisa ficar visível ao
 * lado da conversa — no desktop, uma coluna fixa à direita. No celular não há
 * "ao lado": a tela é estreita e a coluna sumia por completo (`hidden lg:block`
 * cobria os dois painéis), deixando quem usa no telefone sem acesso ao artefato.
 * A resposta é uma modal em tela cheia, aberta pelo link que acompanha a
 * resposta que o produziu.
 */

export type ActiveArtifact =
  | { kind: "batch"; data: ArtifactData }
  | { kind: "view"; view: View };

function ArtifactBody({
  active,
  onClose,
}: {
  active: ActiveArtifact;
  onClose: () => void;
}) {
  return active.kind === "batch" ? (
    <ArtifactPanelInner data={active.data} onClose={onClose} />
  ) : (
    <ViewPanelInner view={active.view} onClose={onClose} />
  );
}

const titleOf = (active: ActiveArtifact) =>
  active.kind === "batch" ? active.data.title : active.view.title;

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
      className="hidden w-[480px] shrink-0 overflow-y-auto border-l bg-[var(--clara-white)] lg:block"
      style={{
        height: "calc(100svh - 3rem)",
        position: "sticky",
        top: "3rem",
        animation: "clara-slidein 0.28s ease",
      }}
      aria-label="Artefato"
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
        className="left-0 top-0 flex h-[100svh] max-h-[100svh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto rounded-none border-0 bg-[var(--clara-white)] p-0 sm:max-w-none lg:hidden"
      >
        {/* Título exigido pelo Radix para leitores de tela; o visível vem do
            cabeçalho do próprio artefato. */}
        <DialogTitle className="sr-only">{active ? titleOf(active) : "Artefato"}</DialogTitle>
        {active ? (
          <ArtifactBody active={active} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * O link que ACOMPANHA a resposta: aparece só nas mensagens que têm um artefato
 * associado, e é o único caminho para o artefato no celular. Abre a coluna à
 * direita na web e a modal no telefone — a decisão de qual é do `Chat`.
 */
export function ArtifactLink({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="clara-link mt-3 inline-flex items-center gap-1.5 text-sm"
    >
      <PanelRightOpen className="size-4" aria-hidden="true" />
      Ver artefato
    </button>
  );
}
