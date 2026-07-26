"use client";

import { FileTextIcon } from "lucide-react";

import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from "@/components/ai-elements/tool";
import { ArtifactLink } from "@/components/artifact-surface";
import { TOOL_LABEL } from "@/lib/activity";

/**
 * Uma mensagem da conversa, renderizada POR PARTE.
 *
 * Antes, o chat achatava todas as `parts` num único texto — raciocínio,
 * chamadas de tool e anexos eram simplesmente descartados no render, e os
 * componentes `tool.tsx`/`reasoning.tsx` existiam no repo sem nenhum uso.
 * Aqui cada tipo tem seu desenho: texto vira markdown, raciocínio vira um
 * colapsável discreto, tool call vira um cartão recolhido com parâmetros e
 * resultado, anexo vira um chip.
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

const thinkingMessage = (isStreaming: boolean, duration?: number) => {
  if (isStreaming || duration === 0) return <Shimmer duration={1}>Pensando…</Shimmer>;
  if (duration === undefined) return <p>Pensou por alguns segundos</p>;
  return <p>Pensou por {duration}s</p>;
};

export function ChatMessage({
  message,
  hasArtifact,
  onOpenArtifact,
}: {
  message: MessageLike;
  hasArtifact: boolean;
  onOpenArtifact: () => void;
}) {
  const rendered: React.ReactNode[] = [];
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
        const text = typeof part.text === "string" ? part.text : "";
        if (text.trim() === "") break;
        rendered.push(
          <Reasoning key={`reasoning-${index}`} isStreaming={part.state === "streaming"}>
            <ReasoningTrigger getThinkingMessage={thinkingMessage} />
            <ReasoningContent>{text}</ReasoningContent>
          </Reasoning>,
        );
        break;
      }

      case "dynamic-tool": {
        flushText();
        const toolName = typeof part.toolName === "string" ? part.toolName : "";
        const state = typeof part.state === "string" ? part.state : "input-available";
        if (toolName === "" || toolName === "present_view") break;
        if (state === "approval-requested") break;

        rendered.push(
          <Tool key={`tool-${index}`}>
            <ToolHeader
              type="dynamic-tool"
              toolName={toolName}
              title={TOOL_LABEL[toolName] ?? toolName}
              state={state as ToolPart["state"]}
            />
            <ToolContent>
              {part.input !== undefined ? <ToolInput input={part.input} /> : null}
              <ToolOutput
                output={part.output}
                errorText={typeof part.errorText === "string" ? part.errorText : undefined}
              />
            </ToolContent>
          </Tool>,
        );
        break;
      }

      case "file": {
        flushText();
        const filename = typeof part.filename === "string" ? part.filename : "documento";
        rendered.push(
          <span
            key={`file-${index}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--clara-fog)] px-3 py-1.5 text-xs"
          >
            <FileTextIcon className="size-3.5" aria-hidden="true" />
            {filename}
          </span>,
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

  if (rendered.length === 0 && !hasArtifact) return null;

  return (
    <Message from={message.role}>
      <MessageContent>
        {rendered}
        {/* O link ACOMPANHA o artefato: só as respostas que têm um aparecem
            com "Ver artefato" — e uma resposta que só desenhou um painel, sem
            texto, ainda precisa do link para alcançá-lo. */}
        {hasArtifact ? <ArtifactLink onOpen={onOpenArtifact} /> : null}
      </MessageContent>
    </Message>
  );
}
