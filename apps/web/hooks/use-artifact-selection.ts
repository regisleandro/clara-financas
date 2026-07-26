"use client";

import { useEffect, useMemo, useState } from "react";

import type { ActiveArtifact } from "@/components/artifact-surface";
import type { ArtifactData } from "@/components/artifact-panel";
import type { View } from "@clara-financas/views";
import { findMessageView, findPresentedView } from "@clara-financas/views/stream";

/**
 * Qual artefato está aberto na tela, e o que ele mostra.
 *
 * `latest` = o mais recente (a coluna reabre sozinha quando a Clara produz um
 * artefato novo). `view`/`batch` = o de UMA resposta específica, aberto pelo
 * link que a acompanha. Guardar uma referência, e não o conteúdo, mantém o
 * painel reativo: se o lote é registrado ou a conversa é reiniciada, o alvo
 * some e o painel fecha sozinho.
 */
export type ArtifactSelection =
  | { type: "latest" }
  | { type: "batch" }
  | { type: "view"; id: string }
  | null;

export function useArtifactSelection({
  messages,
  events,
  artifact,
  proposalMessageId,
  onInvalidView,
}: {
  messages: readonly { id: string; role: string; parts: readonly unknown[] }[];
  events: readonly unknown[];
  /** A conferência do lote com os botões do gate, montada pelo chamador. */
  artifact: ArtifactData | null;
  proposalMessageId: string | null;
  onInvalidView?: (issues: string[], callId?: string) => void;
}) {
  const [selection, setSelection] = useState<ArtifactSelection>(null);

  /**
   * O painel que a CLARA mandou desenhar, lido do stream. Substitui a
   * inferência antiga — o frontend olhava o retorno das ferramentas e
   * adivinhava um painel, errando nos dois sentidos.
   */
  const presented = useMemo(
    () => findPresentedView(events, onInvalidView),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events],
  );

  /** O artefato de CADA resposta, indexado pela mensagem que o produziu. */
  const messageArtifacts = useMemo(() => {
    const map = new Map<string, { kind: "view"; view: View } | { kind: "batch" }>();
    for (const message of messages) {
      if (message.role === "user") continue;
      const view = findMessageView(message, onInvalidView);
      if (view !== null) map.set(message.id, { kind: "view", view });
    }
    if (proposalMessageId !== null && artifact !== null) {
      map.set(proposalMessageId, { kind: "batch" });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, proposalMessageId, artifact]);

  /**
   * O que a seleção aponta, resolvido para o conteúdo a desenhar — ou `null`,
   * que fecha painel e modal de uma vez.
   */
  const active = useMemo<ActiveArtifact | null>(() => {
    if (selection === null) return null;
    const batch: ActiveArtifact | null =
      artifact !== null ? { kind: "batch", data: artifact } : null;
    if (selection.type === "batch") return batch;
    if (selection.type === "latest") {
      return batch ?? (presented !== null ? { kind: "view", view: presented } : null);
    }
    const found = messageArtifacts.get(selection.id);
    if (found === undefined) return null;
    return found.kind === "batch" ? batch : { kind: "view", view: found.view };
  }, [selection, artifact, presented, messageArtifacts]);

  // Painel novo reabre a coluna, seguindo o artefato mais recente: a pessoa
  // acabou de pedir algo que o produz.
  const openKey = artifact?.title ?? presented?.title ?? null;
  useEffect(() => {
    if (openKey !== null) setSelection({ type: "latest" });
  }, [openKey]);

  const openArtifact = (messageId: string) => {
    const found = messageArtifacts.get(messageId);
    if (found === undefined) return;
    setSelection(found.kind === "batch" ? { type: "batch" } : { type: "view", id: messageId });
  };

  return {
    selection,
    setSelection,
    presented,
    messageArtifacts,
    active,
    panelOpen: active !== null,
    openArtifact,
  };
}
