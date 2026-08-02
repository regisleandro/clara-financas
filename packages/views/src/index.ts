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
 * O que sustenta um número, e como ele foi construído. Um campo, duas
 * perguntas — porque a resposta às duas é a mesma.
 *
 * Este campo nasceu duas vezes, em duas frentes, contra dois sintomas. Vale
 * registrar os dois, porque juntos eles explicam por que o vocabulário tem esta
 * forma e não uma mais curta.
 *
 * **De onde vem o valor.** A regra de proveniência morava no `kind`: uma lista
 * `traceable = kind !== "commitments" && kind !== "checksum"` que crescia a
 * cada forma nova. Três defeitos do mesmo desenho saíram dela:
 *
 *  - a conferência de fatura reprovava na validação justamente quando a conta
 *    não bate (corrigido pendurando `checksum` na lista);
 *  - o histórico de faturas não tinha forma nenhuma (corrigido pendurando
 *    `invoices` na lista);
 *  - e o esquecimento nunca falha alto: uma forma nova cujo autor não lembre da
 *    lista nasce recusando painéis, em silêncio, no meio de uma conversa.
 *
 * A lista também não descia ao nível certo. Dentro de uma forma "rastreável"
 * existem números que não somam lançamento nenhum: o ajuste no nível da FATURA
 * (`prepare_invoice_resolution` devolve `targetTransactionId: null` porque não
 * há linha culpada) e a projeção anual de uma recorrência (`annualizedCents`
 * projeta o futuro; os ids são das cobranças passadas). O primeiro era
 * inexprimível; o segundo passava com ids que não somam o valor exibido —
 * proteção só na aparência.
 *
 * **Como o valor foi construído.** Sem declarar a operação, o valor é um
 * inteiro solto e quem o recebe precisa adivinhar o que ele significa:
 *
 *  - a interface decidia se um número era dinheiro por uma regex sobre o
 *    rótulo, e `{ label: "Total de assinaturas", text: "6" }` virava R$ 0,06;
 *  - a conferência de painel inferia a forma pelo `kind`, então uma diferença
 *    dentro de uma composição passaria batida.
 *
 * As duas perguntas caem no mesmo eixo: **`sum` é o único valor que promete
 * fechar com os próprios ids.** Todos os outros dizem, cada um à sua maneira,
 * "não me confira somando" — e é exatamente por isso que a proveniência não é
 * exigida deles. Uma regra, dois usos: `checkView` recusa `sum` sem ids, e
 * `auditView` (em `save-analysis`) reconstrói a soma só dos `sum`.
 *
 * `sum` e não `ledger`: ao lado de `delta` e `projection`, que são operações, o
 * nome da fonte seria um erro de categoria. Ver `@clara-financas/ledger/figure`
 * para as equações que cada forma satisfaz.
 *
 * Quem não declara herda o padrão da FORMA (`DEFAULT_BASIS`), que o compilador
 * obriga a existir para cada `kind` — é o que faz uma forma nova não poder
 * nascer quebrada em silêncio.
 */
export const BASIS = ["sum", "delta", "projection", "document", "schedule", "count"] as const;
export type Basis = (typeof BASIS)[number];

export const BasisSchema = z
  .enum(BASIS)
  .optional()
  .describe(
    "How this number was built, and therefore how it can be checked. `sum` — the total of its own transactionIds, which are then required. `delta` — a difference between two figures (ids are the union of both). `projection` — a real figure times a factor (ids belong to the base). `document` — a total the document declares, or a delta calculated over one invoice. `schedule` — an upcoming commitment, which left no ledger entry. `count` — not money at all, never format as currency. Omit to take the panel's default.",
  );

const basis = BasisSchema;

const RowSchema = z.object({
  label: z.string().min(1).describe("Row label, in Brazilian Portuguese. Use the `label` a tool returned, never the raw identifier."),
  amount: cents.optional(),
  basis,
  /** Texto livre à direita — participação, variação, contagem. */
  detail: z.string().optional(),
  /**
   * 0 a 1. Vira barra de proporção; ausente, não desenha barra.
   *
   * O denominador é o número em DESTAQUE do painel — é isso que a barra
   * comunica. Uma fração de qualquer outra base não cabe aqui: numa comparação,
   * a contribuição da categoria para o aumento tem como base só os aumentos, e
   * desenhá-la como proporção do delta líquido produzia barra de 100% ao lado
   * de "Diferença R$ 2,00". Fração de outra base vai por extenso no `detail`,
   * dizendo de que é fração.
   */
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
    /*
     * Centavos em `text` viram número solto na tela — este guarda existe por
     * isso e continua valendo. O que ele não pode mais fazer é reprovar uma
     * CONTAGEM: "Total de assinaturas: 6" casa com a regex do rótulo e é um
     * inteiro nu, e a versão que olhava só essas duas coisas recusava o painel
     * inteiro — a Clara calculava certo, o schema reprovava, e a resposta
     * apontava para um lado vazio.
     *
     * `basis: "count"` é a declaração de que aquele número não é dinheiro, e
     * quem declara sai da suspeita. Sem declarar, a suspeita continua de pé:
     * quem esquece de dizer é justamente quem está pondo centavos no lugar
     * errado.
     */
    const moneyLabel =
      /\b(valor|total|gasto|gastos|saldo|diferença|ajuste|custo|preço|pagamento|fatura|economia)\b/i;
    if (
      metric.text !== undefined &&
      metric.basis !== "count" &&
      moneyLabel.test(metric.label) &&
      /^-?\d+$/.test(metric.text.trim())
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message:
          'centavos devem usar amount; para um número que não é dinheiro, declare basis: "count"',
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
    kind: z.literal("metric").describe("One question, one answer: 'quanto gastei com mercado?'."),
    metric: MetricSchema,
    rows: z.array(RowSchema).max(20).default([]),
  }),

  /** Composição: para onde o dinheiro foi. Barras proporcionais. */
  z.object({
    ...base,
    kind: z.literal("breakdown").describe("Where the money went, by category. Rows must sum to the metric."),
    metric: MetricSchema.optional(),
    rows: z.array(RowSchema).min(1).max(30),
  }),

  /** Dois períodos lado a lado, com o que explica a diferença. */
  z.object({
    ...base,
    kind: z.literal("comparison").describe("Two periods: 'por que subiu?'. Row deltas must sum to the metric delta."),
    metric: MetricSchema.optional(),
    previousLabel: z.string().min(1),
    currentLabel: z.string().min(1),
    rows: z.array(RowSchema).min(1).max(30),
  }),

  /**
   * A evolução ao longo de vários períodos — três faturas, seis meses.
   *
   * Existia como uma família de artefato PARALELA (`conversation_artifacts`,
   * `present_financial_artifact`, um painel próprio no frontend), porque o
   * vocabulário aqui não tinha uma forma para série. O custo era duas famílias
   * de artefato incompatíveis para o mesmo trabalho, e um coordenador que
   * precisava aprender a rotear entre elas.
   *
   * As linhas são os PONTOS da série, um por período, cada um somando os
   * próprios lançamentos. O destaque é a variação entre o primeiro e o último —
   * uma diferença, não a soma dos pontos. Por isso esta forma não é aditiva: os
   * pontos são momentos no tempo, não partes de um todo.
   *
   * Os fatores que explicam a mudança vão num painel `comparison` separado, o
   * que é possível desde que o recibo do analista passou a carregar vários
   * artefatos.
   */
  z.object({
    ...base,
    kind: z.literal("series").describe("Evolution across three or more periods. One row per period; the metric is the change between first and last."),
    metric: MetricSchema.optional(),
    rows: z.array(RowSchema).min(2).max(12),
  }),

  /** Assinaturas e cobranças que repetem, com custo anual. */
  z.object({
    ...base,
    kind: z.literal("recurrences").describe("What repeats monthly, with annual cost."),
    rows: z.array(RowSchema).min(1).max(30),
  }),

  /** Lista de lançamentos — o razão, rastreável até o documento. */
  z.object({
    ...base,
    kind: z.literal("transactions").describe("Specific ledger entries, when the person asks to see them."),
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
    kind: z
      .literal("invoices")
      .describe(
        "The invoice history, one row per invoice. Call it after list_invoices: `label` the invoiceLabel, `amount` the totalToShow that tool returns (the declared total, or the extracted one when the document declares none), and `detail` the cycle and due date. For 'mês a mês' pass oldestFirst: true to list_invoices and keep that order — a series read backwards is not a series. These rows carry no transactionIds: an invoice total is a fact of the document, not a sum you chose. Say in `detail` when a row is still a draft, and mark a mismatch with accent: 'attention'. To go from one invoice to its entries, read_batch and a `transactions` panel.",
      ),
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
    kind: z.literal("commitments").describe("What is coming due. Use after list_commitments — a due date read out in prose cannot be scanned. Put days remaining in `detail` ('vence em 3 dias · 12/08') and urgency in `accent`: danger when overdue or within a week, attention for this month. These rows carry no transactionIds: a reminder is not a ledger entry."),
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
    kind: z.literal("proposal").describe("What you are about to change, BEFORE changing it: a categorisation triage, a reclassification, or the reach of a learned rule from apply_learned_rules with dryRun. One row per entry, `label` the merchant and `detail` the move ('Sem categoria → Assinaturas'), with the transactionIds that back it. The decision itself still opens on the corresponding tool."),
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
    kind: z.literal("checksum").describe("The verification of an invoice. When the document declares no total, pass declaredTotal: null and result: 'no_declared_total' — never invent a zero. Always pass the proposal's batchId."),
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
  metric: "sum",
  breakdown: "sum",
  comparison: "sum",
  /*
   * Os PONTOS de uma série somam os próprios lançamentos, como em qualquer
   * composição. O que não é soma ali é o destaque — a variação entre o
   * primeiro e o último ponto —, e ele declara `delta` na própria métrica.
   */
  series: "sum",
  recurrences: "sum",
  transactions: "sum",
  invoices: "document",
  commitments: "schedule",
  proposal: "sum",
  checksum: "document",
};

/**
 * A base efetiva de uma célula: o que ela declarou, ou o padrão da forma.
 *
 * Existe para que a resolução aconteça em UM lugar. Ela é feita em três — a
 * validação aqui, a conferência aritmética em `save-analysis` e a formatação na
 * tela —, e se cada um aplicasse o próprio `?? DEFAULT_BASIS[kind]` a primeira
 * divergência entre eles seria invisível: o painel passaria na validação com
 * uma base e seria conferido com outra.
 */
export function basisOf(
  kind: z.infer<typeof ViewShapeSchema>["kind"],
  entry: { basis?: Basis },
): Basis {
  return entry.basis ?? DEFAULT_BASIS[kind];
}

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

  /*
   * `sum` é o único valor que promete fechar com os próprios ids — por isso é o
   * único que os exige. Os demais dizem, cada um à sua maneira, "não me confira
   * somando", e cobrar proveniência deles seria pedir uma prova que não existe.
   */
  const metric = "metric" in view ? view.metric : undefined;
  if (
    metric !== undefined &&
    metric.amount !== undefined &&
    basisOf(view.kind, metric) === "sum" &&
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
    if (basisOf(view.kind, row) !== "sum") continue;
    if (!statesMoney(row) && !aboutEntries) continue;
    if (row.transactionIds.length > 0) continue;

    issues.push({
      path: ["rows", index, "transactionIds"],
      message:
        'uma linha do razão exige transactionIds — ou declare basis nesta linha ("document" para um total do documento, "projection" para um valor projetado, "count" para o que não é dinheiro) quando o valor não é soma de lançamentos',
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

