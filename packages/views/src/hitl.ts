/**
 * Leitura dos pedidos de decisão humana nas mensagens do eve.
 *
 * Quando uma tool exige aprovação, o eve estaciona o turno e pendura o pedido
 * numa parte `dynamic-tool`, em `toolMetadata.eve.inputRequest`.
 *
 * O detalhe que custou caro: **`inputRequest` NÃO some depois de respondido**.
 * O eve grava a resposta ao lado, em `toolMetadata.eve.inputResponse`, e
 * mantém os dois — faz sentido, é o histórico da decisão. Mas quem procurar só
 * por `inputRequest` encontra pedidos já resolvidos e os trata como pendentes,
 * respondendo a um `requestId` morto. O turno nunca retoma, e a tela fica
 * "processando" para sempre.
 *
 * Mora aqui, e não no frontend, porque é código puro que precisa de teste: foi
 * exatamente o que ninguém testou quando vivia dentro de um componente.
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

/** O pedido que ainda espera decisão, ou null. */
export function findPendingRequest(messages: unknown): PendingRequest | null {
  const list = Array.isArray(messages) ? messages : [];

  // De trás para frente: só o pedido mais recente pode estar pendente.
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const parts = asRecord(list[index])?.parts;
    if (!Array.isArray(parts)) continue;

    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const record = asRecord(parts[partIndex]);
      if (record?.type !== "dynamic-tool") continue;

      const eve = asRecord(asRecord(record.toolMetadata)?.eve);
      const request = asRecord(eve?.inputRequest);
      if (!request) continue;

      // Já respondido: é histórico, não pendência.
      if (eve?.inputResponse !== undefined && eve.inputResponse !== null) continue;

      // A tool já produziu resultado: a decisão foi tomada e executada, mesmo
      // que a resposta não tenha sido projetada de volta na parte.
      if (record.output !== undefined && record.output !== null) continue;

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
 * Lotes já registrados no razão, segundo o resultado de `commit_batch`.
 *
 * Serve para o cartão de conferência SUMIR depois do registro. Sem isto ele
 * fica na tela oferecendo "Registrar fatura" sobre um lote que já entrou — e
 * um botão que promete uma escrita já feita é pior que um botão inútil: ele
 * sugere que nada aconteceu.
 */
export function findCommittedBatchIds(messages: unknown): Set<string> {
  const committed = new Set<string>();
  const list = Array.isArray(messages) ? messages : [];

  for (const message of list) {
    const parts = asRecord(message)?.parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      const record = asRecord(part);
      if (record?.type !== "dynamic-tool" || record.toolName !== "commit_batch") continue;

      const output = asRecord(record.output);
      if (output?.status !== "confirmed") continue;
      if (typeof output.batchId === "string") committed.add(output.batchId);
    }
  }

  return committed;
}

/**
 * A proposta de lote mais recente que ainda NÃO foi registrada.
 *
 * O pedido de aprovação de `commit_batch` carrega só o `batchId`, então o
 * cartão se alimenta do resultado de `propose_batch`. Mas esse resultado fica
 * na conversa para sempre — daí o filtro pelos lotes já confirmados.
 */
export function findOpenBatchProposal(messages: unknown): UnknownRecord | null {
  return findOpenBatchProposalLocation(messages)?.output ?? null;
}

/**
 * Como `findOpenBatchProposal`, mas diz TAMBÉM em qual mensagem o lote nasceu.
 *
 * O `messageId` é o que permite pendurar o link "Ver artefato" na resposta
 * certa — a que trouxe a conferência — em vez de num cartão solto no fim da
 * conversa. Fica `null` quando a mensagem não carrega id (nada quebra: o link
 * simplesmente não aparece).
 */
export function findOpenBatchProposalLocation(
  messages: unknown,
): { messageId: string | null; output: UnknownRecord } | null {
  const committed = findCommittedBatchIds(messages);
  const list = Array.isArray(messages) ? messages : [];

  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = asRecord(list[index]);
    const parts = message?.parts;
    if (!Array.isArray(parts)) continue;

    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const record = asRecord(parts[partIndex]);
      if (record?.type !== "dynamic-tool") continue;
      if (record.toolName !== "propose_batch" && record.toolName !== "edit_proposed_batch") {
        continue;
      }

      const output = asRecord(record.output);
      if (!output || typeof output.batchId !== "string" || !asRecord(output.checksum)) continue;
      if (committed.has(output.batchId)) return null;

      return { messageId: typeof message?.id === "string" ? message.id : null, output };
    }
  }

  return null;
}
