"use client";

import { FileTextIcon } from "lucide-react";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@clara-financas/ui/components/attachment";

import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { ArtifactLink } from "@/components/artifact-surface";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Uma mensagem da conversa, renderizada POR PARTE.
 *
 * Antes, o chat achatava todas as `parts` num único texto — raciocínio,
 * chamadas de tool e anexos eram simplesmente descartados no render, e os
 * componentes `tool.tsx`/`reasoning.tsx` existiam no repo sem nenhum uso.
 * Aqui só o que pertence à pessoa vira conteúdo: texto final, anexos e o link
 * do artefato. Raciocínio, nomes de tools, inputs e outputs são detalhes de
 * execução; o `ExecutionTrace` os traduz para etapas humanas sem expor JSON.
 *
 * Duas exclusões deliberadas:
 * - `present_view` não vira cartão de tool: o input dela É o painel, que já
 *   aparece na coluna de artefato. Um cartão aqui seria o mesmo conteúdo
 *   duas vezes.
 * - Partes em `approval-requested` não viram cartão: o gate pendente é
 *   renderizado pelo `DecisionCard`/`GenericPrompt`, que carregam os botões.
 */

type MessageLike = {
  id: string;
  role: "assistant" | "system" | "user";
  parts: readonly unknown[];
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;

export function ChatMessage({
  message,
  hasArtifact,
  artifactLabel,
  onOpenArtifact,
}: {
  message: MessageLike;
  hasArtifact: boolean;
  artifactLabel?: string;
  onOpenArtifact: () => void;
}) {
  const rendered: React.ReactNode[] = [];
  const toolFallbacks: React.ReactNode[] = [];
  // Texto contíguo é juntado num bloco só de markdown: o modelo emite várias
  // partes `text` no mesmo passo, e renderizá-las separadas quebraria
  // parágrafos no meio.
  let textRun: string[] = [];

  const flushText = () => {
    const text = textRun.join("").trim();
    textRun = [];
    if (text === "") return;
    rendered.push(
      // MessageResponse é o renderizador de markdown; texto cru em
      // MessageContent deixava `**negrito**` à mostra.
      <MessageResponse key={`text-${rendered.length}`}>{text}</MessageResponse>,
    );
  };

  for (const [index, raw] of message.parts.entries()) {
    const part = asRecord(raw);
    if (part === undefined) continue;

    switch (part.type) {
      case "text": {
        if (typeof part.text === "string") textRun.push(part.text);
        break;
      }

      case "reasoning": {
        flushText();
        // Nunca mostramos raciocínio interno. O estado útil vive no trace.
        break;
      }

      case "dynamic-tool": {
        flushText();
        const output = asRecord(part.output);
        const error = asRecord(output?.error);
        const errorMessage =
          typeof error?.message === "string"
            ? error.message
            : typeof output?.error === "string"
              ? output.error
              : null;
        if (errorMessage !== null) {
          toolFallbacks.push(
            <Alert key={`tool-error-${index}`} variant="destructive">
              <AlertTitle>Não consegui concluir esta etapa</AlertTitle>
              <AlertDescription>
                <p>{errorMessage}</p>
                {typeof error?.hint === "string" ? <p>{error.hint}</p> : null}
              </AlertDescription>
            </Alert>,
          );
        } else if (
          output?.status === "applied" ||
          output?.status === "confirmed" ||
          output?.alreadyApplied === true
        ) {
          toolFallbacks.push(
            <Alert key={`tool-receipt-${index}`}>
              <AlertTitle>Alteração concluída</AlertTitle>
              <AlertDescription>
                A operação foi registrada e tem recibo na trilha de auditoria.
              </AlertDescription>
            </Alert>,
          );
        }
        break;
      }

      case "file": {
        flushText();
        rendered.push(
          <Attachment
            key={`file-${index}`}
            size="sm"
            className="rounded-[var(--clara-radius-tile)]"
          >
            <AttachmentMedia>
              <FileTextIcon aria-hidden="true" />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>Fatura enviada</AttachmentTitle>
              <AttachmentDescription>Documento PDF</AttachmentDescription>
            </AttachmentContent>
          </Attachment>,
        );
        break;
      }

      // `step-start` é fronteira interna; `authorization` ainda não tem
      // desenho próprio e não deve virar JSON na tela.
      default:
        break;
    }
  }
  flushText();
  if (rendered.length === 0 && toolFallbacks.length > 0) rendered.push(...toolFallbacks);

  if (rendered.length === 0 && !hasArtifact) return null;

  return (
    <Message from={message.role}>
      <MessageContent>
        {rendered}
        {/* O link ACOMPANHA o artefato: só as respostas que têm um aparecem
            com "Ver artefato" — e uma resposta que só desenhou um painel, sem
            texto, ainda precisa do link para alcançá-lo. */}
        {hasArtifact ? <ArtifactLink onOpen={onOpenArtifact} label={artifactLabel} /> : null}
      </MessageContent>
    </Message>
  );
}
