"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ActiveArtifact } from "@/components/artifact-surface";
import type { ArtifactData } from "@/components/artifact-panel";
import {
  artifactKey,
  resolveActive,
  shouldAutoOpen,
  type ArtifactSelection,
  type MessageArtifact,
} from "@/lib/artifact-selection";
import { batchHistoryArtifact, type BatchProposal } from "@/lib/artifact";
import type { View } from "@clara-financas/views";
import type { BatchProposalLocation } from "@clara-financas/views/hitl";
import {
  findMessageFinancialArtifacts,
  findMessageViews,
  findPresentedFinancialArtifacts,
  findPresentedViews,
} from "@clara-financas/views/stream";

/**
 * Qual artefato está aberto na tela, e o que ele mostra.
 *
 * `latest` = o mais recente (a coluna reabre sozinha quando a Clara produz um
 * artefato novo). `view`/`batch` = o de UMA resposta específica, aberto pelo
 * link que a acompanha. Guardar uma referência, e não o conteúdo, mantém o
 * painel reativo: se o lote é registrado ou a conversa é reiniciada, o alvo
 * some e o painel fecha sozinho.
 *
 * A resolução de "qual é o mais recente" e a chave que reabre a coluna são
 * puras e moram em `lib/artifact-selection`, com teste.
 */
export type { ArtifactSelection };

export function useArtifactSelection({
  messages,
  events,
  artifact,
  proposalMessageId,
  proposalBatchId,
  proposals,
  turnId,
  autoOpen,
}: {
  messages: readonly { id: string; role: string; parts: readonly unknown[] }[];
  events: readonly unknown[];
  /** A conferência do lote com os botões do gate, montada pelo chamador. */
  artifact: ArtifactData | null;
  proposalMessageId: string | null;
  proposalBatchId: string | null;
  /** Todas as conferências da conversa, para o histórico das já decididas. */
  proposals: readonly BatchProposalLocation[];
  /** Turno corrente: é o que faz a coluna reabrir a cada pergunta. */
  turnId: string;
  /**
   * Abrir a coluna sozinha quando nasce um artefato.
   *
   * Só no desktop. No celular o artefato é uma modal em tela cheia, e abri-la
   * sozinha cobre a conversa que a pessoa está lendo — inclusive ao reabrir
   * uma conversa antiga, em que a modal aparecia antes de qualquer pergunta.
   * Lá o caminho é o link "Ver artefato", que é o que o desenho sempre disse.
   */
  autoOpen: boolean;
}) {
  const [selection, setSelection] = useState<ArtifactSelection>(null);

  const decidedProposals = useMemo(
    () => proposals.filter((proposal) => proposal.outcome !== "open"),
    [proposals],
  );

  /**
   * O painel que a CLARA mandou desenhar, lido do stream. Substitui a
   * inferência antiga — o frontend olhava o retorno das ferramentas e
   * adivinhava um painel, errando nos dois sentidos.
   *
   * As recusas de schema saem no MESMO memo, como dado: um callback que
   * chamasse `setState` daqui seria atualização em fase de render. É o que
   * permite dizer na tela que o painel não pôde ser montado, em vez de deixar
   * a resposta apontar para uma coluna vazia.
   */
  const { presented, presentedFinancial, invalidIssues } = useMemo(() => {
    const issues: string[] = [];
    const views = findPresentedViews(events, (found) => issues.push(...found));
    const financial = findPresentedFinancialArtifacts(events, (found) => issues.push(...found));
    return { presented: views, presentedFinancial: financial, invalidIssues: issues };
  }, [events]);

  /** O artefato de CADA resposta, indexado pela mensagem que o produziu. */
  const messageArtifacts = useMemo(() => {
    const map = new Map<string, MessageArtifact>();
    for (const message of messages) {
      if (message.role === "user") continue;
      const views = findMessageViews(message);
      const financial = findMessageFinancialArtifacts(message);
      if (financial.length > 0) map.set(message.id, { kind: "financial", artifacts: financial });
      else if (views.length > 0) map.set(message.id, { kind: "view", views });
    }
    // Conferências já decididas continuam alcançáveis pelo link da resposta
    // que as trouxe — sem botões, porque a decisão já foi tomada. Sem isto o
    // link sumia da mensagem antiga no instante da decisão, e a conversa
    // passava a falar de uma conferência sem lugar nenhum.
    for (const proposal of decidedProposals) {
      if (proposal.messageId === null) continue;
      map.set(proposal.messageId, {
        kind: "batchHistory",
        data: batchHistoryArtifact(
          proposal.output as unknown as BatchProposal,
          proposal.outcome === "confirmed" ? "confirmed" : "rejected",
        ),
      });
    }
    if (proposalMessageId !== null && artifact !== null) {
      map.set(proposalMessageId, { kind: "batch" });
    }
    return map;
  }, [messages, proposalMessageId, artifact, decidedProposals]);

  /**
   * O que a seleção aponta, resolvido para o conteúdo a desenhar — ou `null`,
   * que fecha painel e modal de uma vez.
   */
  const active = useMemo<ActiveArtifact | null>(
    () =>
      resolveActive<ArtifactData>(selection, {
        batch: artifact,
        presented,
        financial: presentedFinancial,
        messageArtifacts,
        batchId: proposalBatchId,
      }),
    [selection, artifact, presented, presentedFinancial, messageArtifacts, proposalBatchId],
  );

  // Painel novo reabre a coluna, seguindo o artefato mais recente: a pessoa
  // acabou de pedir algo que o produz.
  const openKey = artifactKey({
    batchId: proposalBatchId,
    batchTitle: artifact?.title ?? null,
    hasPresented: presented.length > 0,
    hasFinancial: presentedFinancial.length > 0,
    turnId,
  });

  // O artefato que JÁ EXISTIA quando esta conversa foi aberta. Ref e não
  // estado: é uma marca do instante da montagem, não algo que a tela desenha.
  // O componente é remontado ao trocar de conversa (`key` no pai), então a
  // marca acompanha a conversa corrente. Ver `shouldAutoOpen`.
  const mountKeyRef = useRef<string | null | undefined>(undefined);
  if (mountKeyRef.current === undefined) mountKeyRef.current = openKey;

  useEffect(() => {
    if (shouldAutoOpen({ openKey, mountKey: mountKeyRef.current, autoOpen })) {
      setSelection({ type: "latest" });
    }
  }, [openKey, autoOpen]);

  const openArtifact = (messageId: string) => {
    const found = messageArtifacts.get(messageId);
    if (found === undefined) return;
    // Histórico e painel abrem pelo id da mensagem; só a conferência ABERTA
    // usa o alvo "batch", que é o que segue o lote enquanto ele muda.
    setSelection(found.kind === "batch" ? { type: "batch" } : { type: "view", id: messageId });
  };

  return {
    selection,
    setSelection,
    presented,
    /**
     * A Clara mandou desenhar um painel e o contrato o recusou. A resposta em
     * texto costuma dizer "veja o painel ao lado", e sem isto o lado fica
     * vazio sem explicação — o sintoma indepurável era exatamente esse.
     */
    panelFailed: presented.length === 0 && presentedFinancial.length === 0 && invalidIssues.length > 0,
    invalidIssues,
    messageArtifacts,
    presentedFinancial,
    active,
    panelOpen: active !== null,
    openArtifact,
  };
}

export type { View };
