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
 * O que sustenta um número — e por que isto é campo de LINHA, não de forma.
 *
 * A regra de proveniência morava no `kind`: uma lista `traceable = kind !==
 * "commitments" && kind !== "checksum"`, que crescia a cada forma nova. Três
 * defeitos com o mesmo desenho saíram dela, e o terceiro só apareceu porque uma
 * pessoa reclamou:
 *
 *  - a conferência de fatura reprovava na validação justamente quando a conta
 *    não bate (corrigido pendurando `checksum` na lista);
 *  - o histórico de faturas não tinha forma nenhuma (corrigido pendurando
 *    `invoices` na lista);
 *  - e o esquecimento nunca falha alto: uma forma nova cujo autor não lembre da
 *    lista nasce recusando painéis, em silêncio, no meio de uma conversa.
 *
 * A lista também não descia ao nível certo. Dentro de uma forma "rastreável"
 * existem números que não são soma de lançamento nenhum: o ajuste no nível da
 * FATURA (`prepare_invoice_resolution` devolve `targetTransactionId: null`
 * porque não há linha culpada) e a projeção anual de uma recorrência
 * (`annualizedCents` projeta o futuro; os ids são das cobranças passadas). O
 * primeiro era inexprimível; o segundo passava com ids que não somam o valor
 * exibido — proteção só na aparência.
 *
 * Agora a linha DECLARA o que está por trás do número. Quem não declara herda o
 * padrão da forma (`DEFAULT_BASIS`), que o compilador obriga a existir para
 * cada `kind` — é o que faz uma forma nova não poder nascer quebrada em
 * silêncio. E o que a linha declara chega à tela: um fato do documento deixa de
 * parecer uma agregação.
 */
export const BASIS = ["ledger", "document", "schedule", "projection"] as const;
export type Basis = (typeof BASIS)[number];

const basis = z
  .enum(BASIS)
  .optional()
  .describe(
    "What backs this value when it is NOT a sum of ledger entries: `document` (a total the document declares, or a delta calculated for one invoice), `schedule` (an upcoming commitment), `projection` (annualised or estimated). Omit for `ledger` — a sum of entries — and then transactionIds is required.",
  );

const RowSchema = z.object({
  label: z.string().min(1).describe("Row label, in Brazilian Portuguese. Use the `label` a tool returned, never the raw identifier."),
  amount: cents.optional(),
  basis,
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
  transactionIds: z.array(z.string().min(1)).default([]),
});

/** Um número em destaque, com legenda. É o topo de quase toda resposta. */
const MetricSchema = z
  .object({
    label: z.string().min(1),
    amount: cents.optional(),
    /** Usado quando o destaque não é dinheiro — "6 assinaturas", "62%". */
    text: z.string().optional(),
    detail: z.string().optional(),
    basis,
    transactionIds: z.array(z.string().min(1)).default([]),
  })
  .superRefine((metric, ctx) => {
    const moneyLabel =
      /\b(valor|total|gasto|gastos|saldo|diferença|ajuste|custo|preço|pagamento|fatura|economia)\b/i;
    if (
      metric.text !== undefined &&
      moneyLabel.test(metric.label) &&
      /^-?\d+$/.test(metric.text.trim())
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message: "centavos devem usar amount; text é apenas para conteúdo não monetário",
      });
    }
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
   * As FATURAS, uma por linha — o histórico mês a mês.
   *
   * Faltava, e a falta não aparecia como erro: aparecia como silêncio. "Liste
   * as faturas mês a mês" tem tool que responde (`list_invoices`) e não tinha
   * forma nenhuma para chegar à tela. `breakdown`, `transactions`, `metric` e
   * `comparison` recusam a linha na validação, porque exigem `transactionIds`
   * de toda linha com valor; `commitments` aceitaria e desenharia "Agenda"
   * sobre uma lista que não é de vencimentos. Sem saída válida, a resposta
   * ficava entre um painel reprovado e a proibição de despejar número no chat —
   * e a pessoa não recebia nada.
   *
   * As linhas NÃO carregam proveniência, pelo mesmo motivo do `checksum`: o
   * total de uma fatura é fato do DOCUMENTO (o que ele declara, ou a soma que a
   * extração leu dele), não uma agregação de lançamentos que a coordenadora
   * escolheu. Para ver os lançamentos de uma fatura existe caminho próprio —
   * `read_batch` e um painel `transactions`, aí com os ids.
   *
   * E não há `metric`: um total somando faturas seria aritmética de modelo
   * sobre dinheiro, que é a origem do pior defeito possível aqui — um número
   * inventado com cara de certo. Cada linha traz o valor que uma tool devolveu.
   */
  z.object({
    ...base,
    kind: z.literal("invoices"),
    rows: z.array(RowSchema).min(1).max(30),
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
 * O que sustenta os números de cada forma, quando a linha não diz.
 *
 * É um `Record` EXAUSTIVO de propósito: acrescentar um `kind` à união sem dizer
 * o que sustenta os números dele não compila. Era exatamente o que a lista
 * anterior (`kind !== "commitments" && kind !== "checksum" && ...`) não fazia —
 * esquecer era legal para o compilador e recusava painéis em produção, calado.
 *
 *  - `ledger` — o valor é soma de lançamentos, e então os ids são obrigatórios;
 *  - `document` — o total que o documento declara, ou uma diferença calculada
 *    sobre ele: `checksum` e `invoices`;
 *  - `schedule` — um compromisso futuro, que não saiu de lançamento nenhum.
 *
 * Uma linha pode DECLARAR outra base (`row.basis`) e sair do padrão da forma:
 * é como um ajuste no nível da fatura entra num painel `proposal` (não há linha
 * culpada para citar) e como a projeção anual de uma recorrência deixa de se
 * passar por soma das cobranças observadas.
 */
export const DEFAULT_BASIS: Record<z.infer<typeof ViewShapeSchema>["kind"], Basis> = {
  metric: "ledger",
  breakdown: "ledger",
  comparison: "ledger",
  recurrences: "ledger",
  transactions: "ledger",
  invoices: "document",
  commitments: "schedule",
  proposal: "ledger",
  checksum: "document",
};

/** Uma linha ou métrica afirma dinheiro? É o que exige origem. */
function statesMoney(entry: { amount?: number; share?: number; trend?: string }): boolean {
  return entry.amount !== undefined || entry.share !== undefined || entry.trend !== undefined;
}

/**
 * As regras SEMÂNTICAS do painel, fora do schema — para poderem se explicar.
 *
 * Ficavam dentro de um `superRefine` do `inputSchema` de `present_view`, e o
 * preço era observabilidade zero: a recusa acontecia antes do corpo da tool,
 * então não gerava resultado, não entrava na telemetria e chegava ao modelo como
 * erro de schema sem saída indicada. O sintoma em produção é o pior possível —
 * a pessoa pede uma lista e não recebe nada, e nenhum registro no banco explica
 * por quê.
 *
 * Aqui as mesmas regras devolvem TEXTO acionável. `ViewSchema` continua
 * aplicando-as (a tela nunca renderiza painel inválido), e a tool passa a
 * devolver um erro recuperável, com `hint`, que a telemetria grava.
 */
export type ViewIssue = { path: Array<string | number>; message: string };

export function checkView(view: z.infer<typeof ViewShapeSchema>): ViewIssue[] {
  const issues: ViewIssue[] = [];

  if (view.kind === "checksum") {
    const expectedDifference =
      view.declaredTotal === null ? null : view.extractedTotal - view.declaredTotal;
    if (view.difference !== expectedDifference) {
      issues.push({
        path: ["difference"],
        message: "difference deve ser extractedTotal - declaredTotal",
      });
    }
    if (
      (view.result === "match" && view.difference !== 0) ||
      (view.result === "mismatch" &&
        (view.declaredTotal === null || view.difference === null || view.difference === 0)) ||
      (view.result === "no_declared_total" &&
        (view.declaredTotal !== null || view.difference !== null))
    ) {
      issues.push({
        path: ["result"],
        message: "result não corresponde aos totais da conferência",
      });
    }
  }

  const fallback = DEFAULT_BASIS[view.kind];

  const metric = "metric" in view ? view.metric : undefined;
  if (
    metric !== undefined &&
    metric.amount !== undefined &&
    (metric.basis ?? fallback) === "ledger" &&
    metric.transactionIds.length === 0
  ) {
    issues.push({
      path: ["metric", "transactionIds"],
      message:
        "uma métrica que soma lançamentos exige transactionIds — ou declare metric.basis quando o valor não sai do razão",
    });
  }

  for (const [index, row] of view.rows.entries()) {
    // Em `recurrences`, `transactions` e `proposal` a linha É um lançamento (ou
    // um conjunto deles), mesmo sem valor: "18 lançamentos viram Assinaturas"
    // sem ids é uma afirmação que ninguém confere antes de aprovar.
    const aboutEntries =
      view.kind === "recurrences" || view.kind === "transactions" || view.kind === "proposal";
    if ((row.basis ?? fallback) !== "ledger") continue;
    if (!statesMoney(row) && !aboutEntries) continue;
    if (row.transactionIds.length > 0) continue;

    issues.push({
      path: ["rows", index, "transactionIds"],
      message:
        'uma linha do razão exige transactionIds — ou declare basis nesta linha ("document" para um total do documento, "projection" para um valor projetado) quando o valor não é soma de lançamentos',
    });
  }

  return issues;
}

/** `rows.2.transactionIds: mensagem` — a forma legível para log e para o modelo. */
export function formatViewIssues(issues: readonly ViewIssue[]): string[] {
  return issues.map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`);
}

/**
 * Proveniência falha fechado. O painel é entrada de modelo, portanto um aviso
 * devolvido depois de desenhá-lo chega tarde demais. Métricas e linhas
 * financeiras sem origem são recusadas antes de alcançar a interface.
 */
export const ViewSchema = ViewShapeSchema.superRefine((view, ctx) => {
  for (const issue of checkView(view)) {
    ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
  }
});

/**
 * A FORMA do painel, sem as regras semânticas.
 *
 * É o `inputSchema` de `present_view`: valida estrutura (kind conhecido, título
 * presente, dinheiro em centavo inteiro) e deixa proveniência para o corpo da
 * tool, que sabe explicar a recusa e deixa rastro. Não use para renderizar —
 * quem desenha usa `ViewSchema`, que aplica as duas camadas.
 */
export const ViewPayloadSchema = ViewShapeSchema;

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
  "invoices",
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
