/**
 * Leitura do pedido de entrada humana no stream do eve.
 *
 * Quando uma tool exige aprovação, ou quando o modelo chama `ask_question`, o
 * eve emite `input.requested` e estaciona o turno. O pedido pendente viaja
 * numa parte `dynamic-tool` da última mensagem, em
 * `part.toolMetadata.eve.inputRequest`.
 *
 * Este módulo isola esse detalhe de formato. Se a forma mudar entre versões do
 * eve — e é beta —, muda só aqui.
 */

export type PendingRequest = {
  requestId: string;
  toolName: string | null;
  prompt?: string;
  options?: Array<{ id?: string; optionId?: string; label?: string }>;
  allowFreeform?: boolean;
  /** Input com que a tool foi chamada: é dele que o cartão se alimenta. */
  toolInput?: unknown;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;

export function findPendingRequest(messages: unknown): PendingRequest | null {
  const list = Array.isArray(messages) ? messages : [];

  // De trás para frente: só o pedido mais recente está de fato pendente.
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const parts = asRecord(list[index])?.parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      const record = asRecord(part);
      if (record?.type !== "dynamic-tool") continue;

      const eve = asRecord(asRecord(record.toolMetadata)?.eve);
      const request = asRecord(eve?.inputRequest);
      if (!request) continue;

      const requestId = request.requestId;
      if (typeof requestId !== "string") continue;

      return {
        requestId,
        toolName: typeof record.toolName === "string" ? record.toolName : null,
        prompt: typeof request.prompt === "string" ? request.prompt : undefined,
        options: Array.isArray(request.options)
          ? (request.options as PendingRequest["options"])
          : undefined,
        allowFreeform:
          typeof request.allowFreeform === "boolean" ? request.allowFreeform : undefined,
        toolInput: record.input ?? request.toolInput,
      };
    }
  }

  return null;
}

/**
 * O resultado de `propose_batch` traz o checksum, mas o pedido de aprovação de
 * `commit_batch` carrega só o `batchId`. Então o cartão se alimenta do último
 * resultado de proposta visto no stream.
 */
export function findLatestBatchProposal(messages: unknown): UnknownRecord | null {
  const list = Array.isArray(messages) ? messages : [];

  for (let index = list.length - 1; index >= 0; index -= 1) {
    const parts = asRecord(list[index])?.parts;
    if (!Array.isArray(parts)) continue;

    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const record = asRecord(parts[partIndex]);
      if (record?.type !== "dynamic-tool") continue;
      if (record.toolName !== "propose_batch" && record.toolName !== "edit_proposed_batch") {
        continue;
      }

      const output = asRecord(record.output);
      if (output && typeof output.batchId === "string" && asRecord(output.checksum)) {
        return output;
      }
    }
  }

  return null;
}
