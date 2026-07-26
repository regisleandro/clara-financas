import type { View } from "@clara-financas/views";

/**
 * Qual artefato a coluna mostra, e quando ela reabre.
 *
 * Isto vivia dentro do hook, em cinco linhas que pareciam óbvias e escondiam
 * dois defeitos que a pessoa sentia em toda conversa. Aqui é código puro, com
 * teste — que é o que faltava para enxergá-los.
 */

export type ArtifactSelection =
  | { type: "latest" }
  | { type: "batch" }
  | { type: "view"; id: string }
  | null;

export type MessageArtifact = { kind: "view"; view: View } | { kind: "batch" };

export type Resolved<TBatch> = { kind: "batch"; data: TBatch } | { kind: "view"; view: View };

/**
 * O artefato "mais recente" quando há uma fatura esperando decisão.
 *
 * O batch vencia sempre, e a consequência era diária: com uma fatura pendente
 * — o que dura enquanto a pessoa não decidir, às vezes dias — QUALQUER pergunta
 * nova respondia na conversa e deixava o painel mostrando a conferência
 * antiga. O painel novo existia e só era alcançável pelo link da mensagem.
 *
 * A regra agora segue a ordem dos acontecimentos: um painel desenhado NESTE
 * turno é mais recente que uma fatura proposta antes. A exceção é a própria
 * conferência — quando o painel do turno é o `checksum` daquela fatura, o
 * cartão é a mesma informação COM os botões da decisão, e é ele que deve
 * aparecer.
 */
export function resolveActive<TBatch>(
  selection: ArtifactSelection,
  context: {
    batch: TBatch | null;
    presented: View | null;
    messageArtifacts: ReadonlyMap<string, MessageArtifact>;
    /** O lote que o cartão de conferência representa, quando há um. */
    batchId?: string | null;
  },
): Resolved<TBatch> | null {
  if (selection === null) return null;

  const batch: Resolved<TBatch> | null =
    context.batch !== null ? { kind: "batch", data: context.batch } : null;
  const presented: Resolved<TBatch> | null =
    context.presented !== null ? { kind: "view", view: context.presented } : null;

  if (selection.type === "batch") return batch;

  if (selection.type === "latest") {
    if (batch === null) return presented;
    if (presented === null) return batch;
    // Conferência da MESMA fatura: o cartão ganha, porque carrega a decisão.
    // Sem `batchId` para comparar, o cartão também ganha — na dúvida, fica o
    // que tem botão.
    const view = context.presented;
    if (view?.kind === "checksum" && (context.batchId == null || view.batchId === context.batchId)) {
      return batch;
    }
    return presented;
  }

  const found = context.messageArtifacts.get(selection.id);
  if (found === undefined) return null;
  return found.kind === "batch" ? batch : { kind: "view", view: found.view };
}

/**
 * A chave que faz a coluna reabrir sozinha quando nasce um artefato.
 *
 * Era o JSON do painel, e isso tinha dois furos. Com uma fatura pendente a
 * chave nem olhava para o painel — então a coluna não reabria para nada. E
 * duas respostas idênticas seguidas produziam a mesma chave: quem tivesse
 * fechado a coluna não a via voltar ao repetir a pergunta.
 *
 * O turno resolve os dois: ele muda a cada pergunta, e é a unidade em que a
 * pessoa pensa ("perguntei de novo, mostre de novo").
 */
export function artifactKey(context: {
  batchId: string | null;
  batchTitle: string | null;
  hasPresented: boolean;
  turnId: string;
}): string | null {
  const parts: string[] = [];
  if (context.batchId !== null || context.batchTitle !== null) {
    parts.push(`batch:${context.batchId ?? context.batchTitle}`);
  }
  if (context.hasPresented) parts.push(`view:${context.turnId}`);
  return parts.length === 0 ? null : parts.join("|");
}
