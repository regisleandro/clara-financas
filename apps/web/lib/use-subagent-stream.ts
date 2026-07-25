"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Assina o stream da sessão FILHA de um subagente.
 *
 * O stream do pai carrega `subagent.called` e `subagent.completed`, mas as
 * ferramentas que o especialista chama por dentro rodam na sessão dele e não
 * aparecem ali. Sem isto, o analista é uma caixa-preta: dá para dizer que ele
 * trabalhou, não o que calculou — e é justamente o resultado calculado que o
 * artefato precisa mostrar.
 *
 * A documentação do eve prevê exatamente este caminho: ler
 * `subagent.called.data.childSessionId` e assinar
 * `GET /eve/v1/session/:childSessionId/stream`.
 */

export type SubagentToolResult = {
  callId: string;
  toolName: string;
  output: unknown;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** Extrai os childSessionId presentes no stream do pai, em ordem. */
export function findChildSessions(events: readonly unknown[]): string[] {
  const ids: string[] = [];
  for (const raw of events) {
    const event = asRecord(raw);
    if (asString(event?.type) !== "subagent.called") continue;
    const id = asString(asRecord(event?.data)?.childSessionId);
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * `generation` identifica a rodada. Turno novo ou conversa nova mudam a chave,
 * e os resultados anteriores são descartados — sem isso o artefato de uma
 * pergunta antiga continuava na tela ao lado da resposta nova, dando a
 * impressão de que aqueles números pertenciam a ela.
 */
export function useSubagentResults(
  host: string,
  childSessionIds: readonly string[],
  getToken: () => Promise<string>,
  generation: string,
): SubagentToolResult[] {
  const [results, setResults] = useState<SubagentToolResult[]>([]);
  const subscribed = useRef(new Set<string>());
  const lastGeneration = useRef(generation);

  if (lastGeneration.current !== generation) {
    lastGeneration.current = generation;
    subscribed.current = new Set();
    if (results.length > 0) setResults([]);
  }

  useEffect(() => {
    const controllers: AbortController[] = [];

    for (const sessionId of childSessionIds) {
      // Uma assinatura por sessão filha, e só uma: o efeito reexecuta a cada
      // evento novo do pai, e sem esta guarda abriríamos um stream por render.
      if (subscribed.current.has(sessionId)) continue;
      subscribed.current.add(sessionId);

      const controller = new AbortController();
      controllers.push(controller);

      void (async () => {
        try {
          const token = await getToken();
          const response = await fetch(`${host}/eve/v1/session/${sessionId}/stream`, {
            headers: { authorization: `Bearer ${token}` },
            signal: controller.signal,
          });
          if (!response.ok || response.body === null) return;

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (line.trim() === "") continue;
              let event: UnknownRecord | undefined;
              try {
                event = asRecord(JSON.parse(line));
              } catch {
                continue;
              }
              if (asString(event?.type) !== "action.result") continue;

              const result = asRecord(asRecord(event?.data)?.result);
              const callId = asString(result?.callId);
              const toolName = asString(result?.toolName);
              if (callId === undefined || toolName === undefined) continue;

              setResults((current) =>
                current.some((item) => item.callId === callId)
                  ? current
                  : [...current, { callId, toolName, output: result?.output }],
              );
            }
          }
        } catch {
          // Stream da filha é complementar: se cair, a conversa segue sem o
          // artefato detalhado. Não é caminho crítico.
        }
      })();
    }

    return () => {
      for (const controller of controllers) controller.abort();
    };
  }, [host, childSessionIds, getToken]);

  return results;
}
