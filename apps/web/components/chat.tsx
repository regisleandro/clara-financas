"use client";

import { useRef } from "react";
import { Paperclip } from "lucide-react";

import {
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
} from "@astryxdesign/core/Chat";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";

import { ApprovalCard } from "@/components/approval-card";
import { ChatWelcome, type Starter } from "@/components/chat-welcome";
import { useAgUiChat } from "@/hooks/use-ag-ui-chat";

/**
 * A conversa, reconstruída sobre Astryx + AG-UI (T028–T031 do plano).
 *
 * Não é o `chat.tsx` antigo traduzido linha a linha: junto do protocolo, saiu
 * também tudo que dependia de peças que ainda não existem do lado do backend
 * novo — o painel de Detalhes (`present_view`, US2, Fase 4), o menu de
 * conversas antigas e a retomada entre recarregamentos de página (o
 * `threadId` nasce novo a cada montagem; ver `use-ag-ui-chat.ts`). Construir
 * essas telas contra dados que não existem seria fachada, não produto — elas
 * voltam quando as ferramentas que as alimentam existirem.
 *
 * O que fica, e é o que importa para US1: enviar a fatura, ver o progresso
 * traduzido (nunca o nome cru da tool — FR-024), decidir no cartão de
 * aprovação (FR-010, FR-011, FR-025), ver a resposta.
 */

const FALLBACK_STARTERS: readonly Starter[] = [
  { title: "Enviar um documento", note: "Fatura, extrato ou nota fiscal em PDF", prompt: null },
];

export function Chat({
  agentHost,
  name,
  starters,
}: {
  agentHost: string;
  name: string | null;
  starters: readonly Starter[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const clara = useAgUiChat({ agentHost });
  const { turns, busy, activity, pending, error, isWelcome, queuedMessages, uploading, uploadingName, progress } =
    clara;

  return (
    <div className="clara-chat-layout">
      <div className="clara-chat-column">
        <ChatLayout
          emptyState={
            <ChatWelcome
              name={name}
              starters={starters.length > 0 ? starters : FALLBACK_STARTERS}
              disabled={busy || uploading}
              onPick={(starter) => {
                if (starter.prompt === null) fileRef.current?.click();
                else clara.send(starter.prompt);
              }}
            />
          }
          composer={
            <ChatComposer
              placeholder="Pergunte sobre seus gastos ou envie um documento"
              onSubmit={(value) => clara.send(value)}
              onStop={clara.cancel}
              isStopShown={busy}
              headerActions={
                <Button
                  label="Anexar fatura em PDF"
                  icon={<Paperclip size={16} aria-hidden="true" />}
                  isIconOnly
                  variant="ghost"
                  size="sm"
                  isDisabled={uploading}
                  onClick={() => fileRef.current?.click()}
                />
              }
              headerContext={
                uploadingName !== null ? (
                  <Text type="supporting" color="secondary">
                    Lendo {uploadingName}
                    {progress !== null ? ` · ${progress}%` : "…"}
                  </Text>
                ) : queuedMessages.length > 0 ? (
                  <Text type="supporting" color="secondary">
                    {queuedMessages.length} mensagem
                    {queuedMessages.length === 1 ? "" : "ns"} aguardando
                  </Text>
                ) : undefined
              }
            />
          }
        >
          {!isWelcome ? (
            <ChatMessageList isStreaming={busy}>
              {turns.map((turn) =>
                turn.text === "" && turn.kind === "assistant" ? null : (
                  <ChatMessage key={turn.id} sender={turn.kind}>
                    <ChatMessageBubble>{turn.text}</ChatMessageBubble>
                  </ChatMessage>
                ),
              )}

              {activity !== null ? (
                <ChatMessage sender="assistant">
                  <ChatMessageBubble variant="ghost">
                    <Text type="supporting" color="secondary">
                      {activity}
                    </Text>
                  </ChatMessageBubble>
                </ChatMessage>
              ) : null}

              {pending !== null ? (
                <ChatMessage sender="assistant">
                  <ChatMessageBubble variant="ghost" width="100%">
                    <ApprovalCard pending={pending} disabled={busy} onAnswer={clara.answer} />
                  </ChatMessageBubble>
                </ChatMessage>
              ) : null}

              {error !== null ? (
                <ChatMessage sender="assistant">
                  <ChatMessageBubble variant="ghost">
                    <Text type="body" color="primary">
                      {error}
                    </Text>
                  </ChatMessageBubble>
                </ChatMessage>
              ) : null}
            </ChatMessageList>
          ) : null}
        </ChatLayout>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void clara.upload(file);
        }}
      />
    </div>
  );
}
