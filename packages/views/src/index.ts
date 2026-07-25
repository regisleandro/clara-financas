import { z } from "zod";

/**
 * O contrato de apresentação entre a Clara e a tela.
 *
 * Antes disto, o frontend ADIVINHAVA o que mostrar: olhava o resultado das
 * ferramentas do analista e inferia um painel. Adivinhação erra de dois jeitos,
 * e os dois apareceram em uso — mostrava painel quando a resposta era uma
 * pergunta, e não mostrava nada quando o formato do retorno mudava.
 *
 * Aqui a decisão passa a ser da Clara: ela escolhe a forma junto com o
 * conteúdo, porque é ela quem sabe o que está respondendo. Uma comparação de
 * períodos pede outra forma que uma lista de assinaturas, e nenhuma heurística
 * de frontend descobre isso com confiabilidade.
 *
 * O vocabulário é PEQUENO de propósito. Um `kind` livre viraria o modelo
 * inventando layout a cada turno, e a tela deixaria de ser previsível — o
 * oposto de uma interface fluida. Cada forma aqui existe porque o protótipo
 * mostra aquela forma.
 */

/** Dinheiro trafega em centavos inteiros, como no razão. Nunca float. */
const cents = z.number().int();

/**
 * Proveniência é ESTRUTURAL, não opcional (H5). Todo número exibido carrega as
 * transações que o compõem, senão "de onde veio esse valor?" não tem resposta.
 */
export const ProvenanceSchema = z.object({
  transactionIds: z.array(z.string()).default([]),
});

const RowSchema = z.object({
  label: z.string().min(1).describe("Row label, in Brazilian Portuguese. Use the `label` a tool returned, never the raw identifier."),
  amount: cents.optional(),
  /** Texto livre à direita — participação, variação, contagem. */
  detail: z.string().optional(),
  /** 0 a 1. Vira barra de proporção; ausente, não desenha barra. */
  share: z.number().min(0).max(1).optional(),
  /** `up` = piorou, `down` = melhorou. Só faz sentido em comparação. */
  trend: z.enum(["up", "down", "flat"]).optional(),
  transactionIds: z.array(z.string()).default([]),
});

/** Um número em destaque, com legenda. É o topo de quase toda resposta. */
const MetricSchema = z.object({
  label: z.string().min(1),
  amount: cents.optional(),
  /** Usado quando o destaque não é dinheiro — "6 assinaturas", "62%". */
  text: z.string().optional(),
  detail: z.string().optional(),
});

const base = {
  title: z.string().min(1).describe("Short panel title, in Brazilian Portuguese."),
  summary: z
    .string()
    .optional()
    .describe("One sentence, in Brazilian Portuguese, saying what the panel shows. Do not repeat the chat reply."),
};

/**
 * As formas. `kind` é o que a Clara escolhe.
 */
export const ViewSchema = z.discriminatedUnion("kind", [
  /** Um número que responde a pergunta, com o detalhe que o sustenta. */
  z.object({
    ...base,
    kind: z.literal("metric"),
    metric: MetricSchema,
    rows: z.array(RowSchema).max(20).default([]),
  }),

  /** Composição: para onde o dinheiro foi. Barras proporcionais. */
  z.object({
    ...base,
    kind: z.literal("breakdown"),
    metric: MetricSchema.optional(),
    rows: z.array(RowSchema).min(1).max(30),
  }),

  /** Dois períodos lado a lado, com o que explica a diferença. */
  z.object({
    ...base,
    kind: z.literal("comparison"),
    metric: MetricSchema.optional(),
    previousLabel: z.string().min(1),
    currentLabel: z.string().min(1),
    rows: z.array(RowSchema).min(1).max(30),
  }),

  /** Assinaturas e cobranças que repetem, com custo anual. */
  z.object({
    ...base,
    kind: z.literal("recurrences"),
    rows: z.array(RowSchema).min(1).max(30),
  }),

  /** Lista de lançamentos — o razão, rastreável até o documento. */
  z.object({
    ...base,
    kind: z.literal("transactions"),
    metric: MetricSchema.optional(),
    rows: z.array(RowSchema).min(1).max(50),
  }),

  /**
   * A conferência (H2). `difference` é o que a pessoa precisa ver primeiro
   * quando não bate — o resto é contexto.
   */
  z.object({
    ...base,
    kind: z.literal("checksum"),
    declaredTotal: cents,
    extractedTotal: cents,
    difference: cents,
    result: z.enum(["match", "mismatch", "no_declared_total"]),
    cause: z.string().optional().describe("Likely cause, in Brazilian Portuguese."),
    rows: z.array(RowSchema).max(20).default([]),
  }),
]);

export type View = z.infer<typeof ViewSchema>;
export type ViewKind = View["kind"];
export type ViewRow = z.infer<typeof RowSchema>;
export type ViewMetric = z.infer<typeof MetricSchema>;

export const VIEW_KINDS = [
  "metric",
  "breakdown",
  "comparison",
  "recurrences",
  "transactions",
  "checksum",
] as const;

/**
 * Valida o que chega do stream antes de renderizar.
 *
 * O payload é produzido por um modelo, então tratar como confiável seria
 * ingenuidade: campo faltando derrubaria a conversa inteira num erro de
 * render. Aqui um payload inválido simplesmente não vira painel, e o texto da
 * resposta segue de pé.
 */
export function parseView(value: unknown): View | null {
  const result = ViewSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Soma os ids de proveniência de um painel, sem repetir. */
export function viewTransactionIds(view: View): string[] {
  const ids = new Set<string>();
  for (const row of view.rows ?? []) {
    for (const id of row.transactionIds) ids.add(id);
  }
  return [...ids];
}
