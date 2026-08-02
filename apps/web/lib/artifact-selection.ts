import type { FinancialArtifact, View } from "@clara-financas/views";

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

export type MessageArtifact =
  | { kind: "view"; views: View[] }
  | { kind: "financial"; artifacts: FinancialArtifact[] }
  /** A conferência aberta, com os botões da decisão. */
  | { kind: "batch" }
  /** A conferência de uma fatura já decidida: mesmo conteúdo, sem ação. */
  | { kind: "batchHistory"; data: unknown };

export type Resolved<TBatch> =
  | { kind: "batch"; data: TBatch }
  | { kind: "view"; views: View[] }
  | { kind: "financial"; artifacts: FinancialArtifact[] };

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
 * conferência — quando o turno só desenhou o `checksum` daquela fatura, o
 * cartão é a mesma informação COM os botões da decisão, e é ele que aparece.
 */
export function resolveActive<TBatch>(
  selection: ArtifactSelection,
  context: {
    batch: TBatch | null;
    presented: readonly View[];
    financial?: readonly FinancialArtifact[];
    messageArtifacts: ReadonlyMap<string, MessageArtifact>;
    /** O lote que o cartão de conferência representa, quando há um. */
    batchId?: string | null;
  },
): Resolved<TBatch> | null {
  if (selection === null) return null;

  const batch: Resolved<TBatch> | null =
    context.batch !== null ? { kind: "batch", data: context.batch } : null;
  const presented: Resolved<TBatch> | null =
    context.presented.length > 0 ? { kind: "view", views: [...context.presented] } : null;
  const financialArtifacts = context.financial ?? [];
  const financial: Resolved<TBatch> | null =
    financialArtifacts.length > 0 ? { kind: "financial", artifacts: [...financialArtifacts] } : null;

  if (selection.type === "batch") return batch;

  if (selection.type === "latest") {
    if (financial !== null) return financial;
    if (batch === null) return presented;
    if (presented === null) return batch;
    // Só a conferência DAQUELA fatura foi desenhada: o cartão ganha, porque
    // carrega a decisão. Se o turno desenhou mais alguma coisa, a pessoa pediu
    // outra coisa — e é essa outra coisa que ela está esperando ver.
    const onlyOwnChecksum = context.presented.every(
      (view) =>
        view.kind === "checksum" &&
        (context.batchId == null || view.batchId === context.batchId),
    );
    return onlyOwnChecksum ? batch : presented;
  }

  const found = context.messageArtifacts.get(selection.id);
  if (found === undefined) return null;
  if (found.kind === "view") return { kind: "view", views: found.views };
  if (found.kind === "financial") return { kind: "financial", artifacts: found.artifacts };
  if (found.kind === "batchHistory") return { kind: "batch", data: found.data as TBatch };
  return batch;
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
  hasFinancial?: boolean;
  turnId: string;
}): string | null {
  const parts: string[] = [];
  if (context.batchId !== null || context.batchTitle !== null) {
    parts.push(`batch:${context.batchId ?? context.batchTitle}`);
  }
  if (context.hasPresented) parts.push(`view:${context.turnId}`);
  if (context.hasFinancial) parts.push(`financial:${context.turnId}`);
  return parts.length === 0 ? null : parts.join("|");
}

/**
 * A coluna abre sozinha por um artefato NOVO — nunca por um que já estava lá.
 *
 * Abrir uma conversa antiga escancarava o painel antes de qualquer pergunta: os
 * eventos retomados do storage já contêm os `present_*` daquela conversa, então
 * a chave nascia preenchida e o efeito disparava na montagem. A pessoa clicava
 * numa conversa para RELER o que foi conversado e recebia meia tela ocupada por
 * um painel que ela não pediu — e no desktop ele ainda empurrava a conversa
 * para uma coluna estreita.
 *
 * A regra passa a comparar com o que existia quando esta conversa foi aberta
 * (`mountKey`). Igual significa "é o artefato que já estava aqui": o painel fica
 * fechado e continua a um clique de distância pelo link da resposta. Diferente
 * significa que a Clara acabou de produzir algo, e aí abrir é o que a pessoa
 * espera.
 *
 * `mountKey` é `undefined` enquanto a primeira renderização não terminou; nesse
 * instante ainda não há com o que comparar, e não abrir é a escolha segura.
 */
export function shouldAutoOpen(context: {
  /** A chave do artefato corrente. */
  openKey: string | null;
  /** A chave observada quando a conversa foi montada. */
  mountKey: string | null | undefined;
  /** Falso no celular, onde o artefato é uma modal em tela cheia. */
  autoOpen: boolean;
}): boolean {
  if (!context.autoOpen) return false;
  if (context.openKey === null) return false;
  if (context.mountKey === undefined) return false;
  return context.openKey !== context.mountKey;
}
