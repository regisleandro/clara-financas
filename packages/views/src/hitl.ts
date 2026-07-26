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
 * O `optionId` que corresponde a aprovar ou negar ESTE pedido.
 *
 * A interface mandava as strings literais `"approve"` e `"deny"`, sem olhar as
 * opções do pedido. Enquanto o harness usar esses ids, funciona; no dia em que
 * usar outros, o `inputResponses` é recusado, o turno não retoma e os botões
 * ficam desabilitados — a decisão morre na tela, sem erro visível. E hoje são
 * três escritas dependendo dessa suposição, não uma.
 *
 * A resolução é por vocabulário e, em último caso, por posição: a primeira
 * opção é a afirmativa e a última é a negativa, que é a convenção de todo
 * pedido de aprovação. Só quando não há opção nenhuma é que a literal volta —
 * aí ela é a única informação disponível.
 */
export type ApprovalIntent = "approve" | "deny";

const APPROVE_WORDS = /^(approve[dr]?|accept|allow|confirm|yes|sim|aprovar?)$/i;
const DENY_WORDS = /^(deny|denied|reject|refuse|decline|cancel|no|nao|não|negar|recusar)$/i;

export function resolveApprovalOption(
  pending: Pick<PendingRequest, "options"> | null,
  intent: ApprovalIntent,
): string {
  const options = pending?.options ?? [];
  const ids = options
    .map((option) => option.optionId ?? option.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (ids.length === 0) return intent;

  const words = intent === "approve" ? APPROVE_WORDS : DENY_WORDS;
  const byWord = ids.find((id) => words.test(id));
  if (byWord !== undefined) return byWord;

  // Pelo rótulo, quando o id é opaco (`opt_1`) mas o texto não é.
  const byLabel = options.find((option) => {
    const label = option.label;
    return typeof label === "string" && words.test(label.trim());
  });
  const labelId = byLabel?.optionId ?? byLabel?.id;
  if (typeof labelId === "string" && labelId.length > 0) return labelId;

  if (ids.length === 1) return ids[0]!;
  return intent === "approve" ? ids[0]! : ids[ids.length - 1]!;
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
  return findDecidedBatchIds(messages, "commit_batch", "confirmed");
}

/**
 * Lotes descartados, segundo o resultado de `reject_batch`.
 *
 * Registrar e descartar fecham a decisão do mesmo jeito, e o cartão precisa
 * sumir nos DOIS casos. Enquanto descartar era só uma frase no chat, isso não
 * aparecia; com a tool escrevendo `status: rejected` de verdade, o cartão
 * sobrevivia ao próprio lote — oferecendo "Registrar fatura" sobre um lote
 * cujas linhas já foram apagadas. Clicar levava a um erro, e o pior é que a
 * pessoa tinha acabado de ver a Clara confirmar que descartou.
 */
export function findRejectedBatchIds(messages: unknown): Set<string> {
  return findDecidedBatchIds(messages, "reject_batch", "rejected");
}

function findDecidedBatchIds(messages: unknown, toolName: string, status: string): Set<string> {
  const decided = new Set<string>();
  const list = Array.isArray(messages) ? messages : [];

  for (const message of list) {
    const parts = asRecord(message)?.parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      const record = asRecord(part);
      if (record?.type !== "dynamic-tool" || record.toolName !== toolName) continue;

      const output = asRecord(record.output);
      if (output?.status !== status) continue;
      if (typeof output.batchId === "string") decided.add(output.batchId);
    }
  }

  return decided;
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
  const latest = findBatchProposals(messages).at(-1);
  if (latest === undefined || latest.outcome !== "open") return null;
  return { messageId: latest.messageId, output: latest.output };
}

export type BatchOutcome = "open" | "confirmed" | "rejected";

export type BatchProposalLocation = {
  messageId: string | null;
  batchId: string;
  output: UnknownRecord;
  outcome: BatchOutcome;
};

/**
 * TODA conferência da conversa, em ordem, com o que aconteceu com cada uma.
 *
 * `findOpenBatchProposalLocation` responde "há decisão pendente?" e só enxerga
 * a última. Faltava a outra pergunta, que a pessoa faz rolando a conversa para
 * cima: "o que aquela fatura dizia mesmo?". O link "Ver artefato" da resposta
 * que trouxe a conferência sumia no instante em que a fatura era decidida —
 * a mensagem continuava lá, falando de uma conferência que já não tinha para
 * onde levar. O histórico reescrito é sempre pior que o histórico completo.
 *
 * Uma proposta pode ser corrigida várias vezes (`edit_proposed_batch` devolve o
 * mesmo `batchId` com a conferência refeita); vale a última leitura de cada
 * lote, que é o estado com que a decisão foi tomada.
 */
export function findBatchProposals(messages: unknown): BatchProposalLocation[] {
  const committed = findCommittedBatchIds(messages);
  const rejected = findRejectedBatchIds(messages);
  const list = Array.isArray(messages) ? messages : [];
  const byBatch = new Map<string, BatchProposalLocation>();

  for (const item of list) {
    const message = asRecord(item);
    const parts = message?.parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      const record = asRecord(part);
      if (record?.type !== "dynamic-tool") continue;
      if (record.toolName !== "propose_batch" && record.toolName !== "edit_proposed_batch") {
        continue;
      }

      const output = asRecord(record.output);
      if (!output || typeof output.batchId !== "string" || !asRecord(output.checksum)) continue;

      const batchId = output.batchId;
      byBatch.set(batchId, {
        // A correção herda a mensagem em que apareceu: é lá que a pessoa a viu.
        messageId: typeof message?.id === "string" ? message.id : null,
        batchId,
        output,
        outcome: committed.has(batchId)
          ? "confirmed"
          : rejected.has(batchId)
            ? "rejected"
            : "open",
      });
    }
  }

  return [...byBatch.values()];
}
