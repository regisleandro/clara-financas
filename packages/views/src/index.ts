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
  transactionIds: z.array(z.string().min(1)).min(1),
});

/**
 * Como o número foi construído — a fórmula viajando junto com o valor.
 *
 * Sem isto, o valor é um inteiro solto e quem o recebe precisa ADIVINHAR o que
 * ele significa. As duas adivinhações que existiam custaram caro:
 *
 *  - a interface decidia se um número era dinheiro por uma regex sobre o
 *    rótulo, e `{ label: "Total de assinaturas", text: "6" }` virava R$ 0,06;
 *  - a validação, com a mesma regex, RECUSAVA o painel inteiro nesse caso — a
 *    Clara calculava certo, o schema reprovava, e a resposta apontava para um
 *    lado vazio;
 *  - a conferência de painel inferia a forma pelo `kind` da view, então uma
 *    diferença dentro de uma composição passaria batida.
 *
 * `sum` é o padrão porque é o caso comum e porque artefato já persistido não
 * declara nada. Ver `@clara-financas/ledger/figure` para as equações que cada
 * forma satisfaz.
 */
export const BasisSchema = z
  .enum(["sum", "delta", "projection", "document", "count"])
  .default("sum")
  .describe(
    "How the number was built: `sum` of its own transactions, `delta` between two figures, `projection` from a real figure, `document` fact with no ledger behind it, or `count` (not money).",
  );

const RowSchema = z.object({
  label: z.string().min(1).describe("Row label, in Brazilian Portuguese. Use the `label` a tool returned, never the raw identifier."),
  amount: cents.optional(),
  /** Texto livre à direita — participação, variação, contagem. */
  detail: z.string().optional(),
  /** 0 a 1. Vira barra de proporção; ausente, não desenha barra. */
  share: z.number().min(0).max(1).optional(),
  /** `up` = piorou, `down` = melhorou. Só faz sentido em comparação. */
  trend: z.enum(["up", "down", "flat"]).optional(),
  /**
   * Severidade da linha, desenhada como um marcador colorido.
   *
   * Existe por causa da agenda: numa lista de vencimentos, "vence amanhã" e
   * "vence em dois meses" são a mesma linha tipograficamente, e a diferença
   * entre elas é justamente o que a pessoa abriu o painel para ver. Ausente,
   * a linha fica neutra — nenhuma forma é obrigada a usar.
   */
  accent: z
    .enum(["attention", "danger", "positive"])
    .optional()
    .describe(
      "Row severity marker: `danger` for what is overdue or imminent, `attention` for what deserves a look, `positive` for what is already settled. Omit for neutral rows.",
    ),
  basis: BasisSchema,
  transactionIds: z.array(z.string().min(1)).default([]),
});

/** Um número em destaque, com legenda. É o topo de quase toda resposta. */
const MetricSchema = z.object({
  label: z.string().min(1),
  amount: cents.optional(),
  /** Usado quando o destaque não é dinheiro — "6 assinaturas", "62%". */
  text: z.string().optional(),
  detail: z.string().optional(),
  basis: BasisSchema,
  transactionIds: z.array(z.string().min(1)).default([]),
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
const ViewShapeSchema = z.discriminatedUnion("kind", [
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
   * A agenda: o que vence, do mais próximo ao mais distante.
   *
   * Faltava uma forma para isto, e a falta tinha consequência: `list_commitments`
   * é ferramenta do coordenador, mas a resposta "o que vence este mês" não tinha
   * painel nenhum para onde ir — ou virava número solto no chat, ou era espremida
   * num `transactions` que promete lançamentos do razão e entrega lembretes.
   *
   * As linhas não carregam proveniência: um compromisso é um lembrete agendado,
   * não um lançamento — não há transação de onde ele tenha saído.
   */
  z.object({
    ...base,
    kind: z.literal("commitments"),
    metric: MetricSchema.optional(),
    rows: z.array(RowSchema).min(1).max(30),
  }),

  /**
   * O que a Clara PROPÕE mudar, antes de mudar.
   *
   * Uma proposta de recategorização, o alcance de uma regra aprendida em
   * simulação, a triagem do guarda-livros — os três são a mesma coisa para
   * quem olha: uma lista de lançamentos que vão mudar de categoria, e a decisão
   * fica na conversa. Sem esta forma, a proposta chegava como parágrafo, e
   * decidir sobre uma lista descrita em prosa é decidir no escuro.
   *
   * Não é o gate: quem abre a decisão é a tool correspondente. O painel é o que
   * a pessoa lê ANTES de clicar.
   */
  z.object({
    ...base,
    kind: z.literal("proposal"),
    metric: MetricSchema.optional(),
    rows: z.array(RowSchema).min(1).max(50),
  }),

  /**
   * A conferência (H2). `difference` é o que a pessoa precisa ver primeiro
   * quando não bate — o resto é contexto.
   *
   * `declaredTotal` e `difference` são nuláveis porque o domínio permite
   * fatura sem total declarado (`ChecksumReport` em `@clara-financas/ledger`).
   * Exigir número aqui forçava o modelo a inventar `0` — e "Total da fatura
   * R$ 0,00" na tela é um número falso — ou a mandar `null` e perder o painel
   * inteiro na validação.
   */
  z.object({
    ...base,
    kind: z.literal("checksum"),
    batchId: z.string().min(1).describe("Batch that produced this verification."),
    declaredTotal: cents.nullable().describe("Null when the document declares no total."),
    extractedTotal: cents,
    difference: cents.nullable().describe("Null when there is no declared total to compare against."),
    result: z.enum(["match", "mismatch", "no_declared_total"]),
    cause: z.string().optional().describe("Likely cause, in Brazilian Portuguese."),
    rows: z.array(RowSchema).max(20).default([]),
  }),
]);

/**
 * Proveniência falha fechado. O painel é entrada de modelo, portanto um aviso
 * devolvido depois de desenhá-lo chega tarde demais. Métricas e linhas
 * financeiras sem origem são recusadas antes de alcançar a interface.
 */
export const ViewSchema = ViewShapeSchema.superRefine((view, ctx) => {
  if (view.kind === "checksum") {
    const expectedDifference =
      view.declaredTotal === null ? null : view.extractedTotal - view.declaredTotal;
    if (view.difference !== expectedDifference) {
      ctx.addIssue({
        code: "custom",
        message: "difference deve ser extractedTotal - declaredTotal",
        path: ["difference"],
      });
    }
    if (
      (view.result === "match" && view.difference !== 0) ||
      (view.result === "mismatch" &&
        (view.declaredTotal === null || view.difference === null || view.difference === 0)) ||
      (view.result === "no_declared_total" &&
        (view.declaredTotal !== null || view.difference !== null))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "result não corresponde aos totais da conferência",
        path: ["result"],
      });
    }
  }

  // `commitments` fica de fora, e não por indulgência: um compromisso é um
  // lembrete agendado — não saiu de lançamento nenhum, então não HÁ id para
  // pedir. Exigir proveniência aqui reprovaria todo painel de vencimentos na
  // validação, e o sintoma seria justamente o que esta regra quer evitar: a
  // pessoa perguntando o que vence e não recebendo painel nenhum.
  //
  // `checksum` sai pelo mesmo motivo, e a falta custou caro: as linhas de uma
  // conferência são "Total declarado", "Total extraído" e "Diferença" — fatos
  // do DOCUMENTO, não somas de lançamentos. A diferença de arredondamento não
  // tem item culpado (é o que `likelyCause: "rounding"` significa), então não
  // existe id para pedir. A métrica já era isenta aqui; as linhas não eram, e
  // o painel de conferência caía na validação exatamente quando mais
  // importava: quando a conta não bate.
  const traceable = view.kind !== "commitments" && view.kind !== "checksum";

  const metric = "metric" in view ? view.metric : undefined;
  if (traceable && metric?.amount !== undefined) {
    if (metric.transactionIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "uma métrica com valor exige transactionIds",
        path: ["metric", "transactionIds"],
      });
    }
  }

  for (const [index, row] of view.rows.entries()) {
    const financial =
      traceable &&
      (row.amount !== undefined ||
        row.share !== undefined ||
        row.trend !== undefined ||
        view.kind === "recurrences" ||
        view.kind === "transactions" ||
        // Uma proposta fala de lançamentos ESPECÍFICOS que vão mudar de
        // categoria. Sem os ids, "18 lançamentos viram Assinaturas" é uma
        // afirmação que ninguém consegue conferir antes de aprovar.
        view.kind === "proposal");
    if (financial && row.transactionIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "uma linha financeira exige transactionIds",
        path: ["rows", index, "transactionIds"],
      });
    }
  }
});

export type View = z.infer<typeof ViewSchema>;

/**
 * O painel como quem o MONTA escreve, antes do parse.
 *
 * Difere de `View` só nos campos com default: `basis` é obrigatório na saída
 * — todo número exibido declara como foi construído — e opcional na entrada,
 * porque `sum` é o caso comum e repetir `basis: "sum"` em cada célula seria
 * ruído que ninguém lê. Quem constrói uma diferença ou uma projeção declara;
 * quem constrói uma soma não precisa dizer nada.
 */
export type ViewInput = z.input<typeof ViewSchema>;
export type ViewKind = View["kind"];
export type ViewRow = z.infer<typeof RowSchema>;
export type ViewMetric = z.infer<typeof MetricSchema>;

export const VIEW_KINDS = [
  "metric",
  "breakdown",
  "comparison",
  "recurrences",
  "transactions",
  "commitments",
  "proposal",
  "checksum",
] as const;

/**
 * Valida o que chega do stream antes de renderizar.
 *
 * O payload é produzido por um modelo, então tratar como confiável seria
 * ingenuidade: campo faltando derrubaria a conversa inteira num erro de
 * render. Aqui um payload inválido simplesmente não vira painel, e o texto da
 * resposta segue de pé.
 *
 * A forma com `issues` existe porque "não virou painel" sem rastro era
 * indepurável em produção: o sintoma era só "o artefato às vezes não abre".
 * Quem consome decide o que fazer com os issues (log, telemetria); o contrato
 * apenas garante que a falha tem descrição.
 */
export type ParseViewResult =
  | { ok: true; view: View }
  | { ok: false; issues: string[] };

export function parseViewResult(value: unknown): ParseViewResult {
  const result = ViewSchema.safeParse(value);
  if (result.success) return { ok: true, view: result.data };
  return {
    ok: false,
    issues: result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`,
    ),
  };
}

export function parseView(value: unknown): View | null {
  const result = parseViewResult(value);
  return result.ok ? result.view : null;
}

/** Soma os ids de proveniência de um painel, sem repetir. */
export function viewTransactionIds(view: View): string[] {
  const ids = new Set<string>();
  for (const row of view.rows ?? []) {
    for (const id of row.transactionIds) ids.add(id);
  }
  return [...ids];
}

export * from "./v3-contracts";
