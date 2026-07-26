import { countsTowardDeclaredTotal } from "./checksum";
import { clusterMerchantKeys, merchantKey } from "./merchant";
import type { Transaction } from "./types";

/**
 * Agregações do razão.
 *
 * Regra que atravessa o módulo inteiro: **todo número vem acompanhado dos IDs
 * das transações que o compõem.** Não é um extra de auditoria — é o que faz
 * "de onde veio esse valor?" ter resposta sempre, sem recalcular nada e sem
 * depender de o modelo lembrar de citar a origem.
 *
 * Nada aqui chama modelo. São funções puras sobre linhas já confirmadas, o que
 * as torna testáveis e reproduzíveis — a hipótese H5 depende disso.
 */

export type Provenance = {
  /** Centavos. */
  value: number;
  transactionIds: string[];
};

export type CategoryTotal = Provenance & {
  category: string | null;
  count: number;
  /** Fração do total do período, 0–1. Só para exibição. */
  share: number;
};

/**
 * Lançamentos que representam gasto do período. Pagamento não é gasto.
 *
 * Genérico em `T` para não descartar o que o chamador acrescentou à transação —
 * a agregação por operadora precisa do `issuer` do outro lado do filtro, e uma
 * assinatura fixa em `Transaction` a obrigaria a refiltrar por conta própria,
 * que é como duas definições de "gasto" começam a existir.
 */
export function spendable<T extends Transaction>(transactions: T[]): T[] {
  return transactions.filter(countsTowardDeclaredTotal);
}

export function totalSpend(transactions: Transaction[]): Provenance {
  const counted = spendable(transactions);
  return {
    value: counted.reduce((sum, transaction) => sum + transaction.amount, 0),
    transactionIds: counted.map((transaction) => transaction.id),
  };
}

/**
 * Composição por categoria, do maior para o menor.
 *
 * Transações sem categoria vêm como `category: null` em vez de serem
 * escondidas ou jogadas num "outros": o que ainda não foi categorizado é
 * justamente o que precisa de atenção.
 */
export function aggregateByCategory(transactions: Transaction[]): CategoryTotal[] {
  const counted = spendable(transactions);
  const total = counted.reduce((sum, transaction) => sum + transaction.amount, 0);
  const buckets = new Map<string | null, { value: number; ids: string[] }>();

  for (const transaction of counted) {
    const key = transaction.category ?? null;
    const bucket = buckets.get(key) ?? { value: 0, ids: [] };
    bucket.value += transaction.amount;
    bucket.ids.push(transaction.id);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([category, bucket]) => ({
      category,
      value: bucket.value,
      transactionIds: bucket.ids,
      count: bucket.ids.length,
      share: total === 0 ? 0 : bucket.value / total,
    }))
    .sort((a, b) => b.value - a.value);
}

export type CategoryComparison = {
  category: string | null;
  current: Provenance;
  previous: Provenance;
  /** `current - previous`, em centavos. */
  delta: number;
  /** Variação relativa, ou `null` quando não havia base anterior. */
  deltaRatio: number | null;
  /** Quanto esta categoria explica da variação total, 0–1. */
  shareOfChange: number;
};

/**
 * Comparação entre dois períodos, por categoria.
 *
 * `shareOfChange` é o que permite a frase "restaurantes explicam 62% do
 * aumento": é a contribuição da categoria para a variação total, e não a
 * variação dela isolada. Sem isso, uma categoria que dobrou de R$ 10 para
 * R$ 20 pareceria mais relevante que uma que subiu R$ 800.
 */
export function comparePeriods(
  current: Transaction[],
  previous: Transaction[],
): { totalDelta: number; categories: CategoryComparison[] } {
  const currentByCategory = index(aggregateByCategory(current));
  const previousByCategory = index(aggregateByCategory(previous));

  const categories = new Set([...currentByCategory.keys(), ...previousByCategory.keys()]);
  const totalDelta = totalSpend(current).value - totalSpend(previous).value;

  // Base da atribuição: só os aumentos. Misturar quedas diluiria a explicação
  // — se uma categoria cai e outra sobe, o total pode nem mudar, mas o
  // aumento continua tendo uma causa identificável.
  const increases = [...categories].map((category) => {
    const now = currentByCategory.get(category);
    const before = previousByCategory.get(category);
    return Math.max(0, (now?.value ?? 0) - (before?.value ?? 0));
  });
  const totalIncrease = increases.reduce((sum, value) => sum + value, 0);

  return {
    totalDelta,
    categories: [...categories]
      .map((category) => {
        const now = currentByCategory.get(category);
        const before = previousByCategory.get(category);
        const currentValue = now?.value ?? 0;
        const previousValue = before?.value ?? 0;
        const delta = currentValue - previousValue;

        return {
          category,
          current: { value: currentValue, transactionIds: now?.transactionIds ?? [] },
          previous: { value: previousValue, transactionIds: before?.transactionIds ?? [] },
          delta,
          deltaRatio: previousValue === 0 ? null : delta / previousValue,
          shareOfChange: totalIncrease === 0 ? 0 : Math.max(0, delta) / totalIncrease,
        };
      })
      .sort((a, b) => b.delta - a.delta),
  };
}

function index(totals: CategoryTotal[]): Map<string | null, CategoryTotal> {
  return new Map(totals.map((total) => [total.category, total]));
}

/**
 * Uma transação do razão acompanhada da operadora que emitiu o documento.
 *
 * A operadora não está na transação: ela é do DOCUMENTO (`documents.issuer`).
 * Entra por composição em vez de virar coluna porque é a mesma informação para
 * todas as linhas do mesmo documento — duplicá-la abriria a possibilidade de
 * uma linha discordar da fatura de onde veio.
 */
export type IssuedTransaction = Transaction & { issuer: string | null };

export type Bucket = Provenance & { count: number };

export type IssuerMonthMatrix = {
  /** `YYYY-MM` presentes no razão, do mais recente para o mais antigo. */
  months: string[];
  issuers: Array<{
    issuer: string | null;
    total: Bucket;
    /**
     * Uma posição por mês de `months`, na mesma ordem. `null` significa que
     * aquela operadora não tem lançamento naquele mês — diferente de zero, que
     * seria "tem lançamentos e eles se anulam".
     */
    byMonth: Array<Bucket | null>;
  }>;
  /** Total de cada mês de `months`, na mesma ordem. */
  monthTotals: Bucket[];
  total: Bucket;
};

/**
 * O razão cruzado por operadora e mês.
 *
 * Três decisões:
 *
 *  1. **O mês é o da COMPRA, não o do fechamento da fatura.** Uma fatura
 *     fechada em julho cobre gastos de maio e junho; classificá-la como julho
 *     colocaria em julho um dinheiro que saiu antes e deixaria maio vazio.
 *
 *  2. **Operadora `null` aparece como linha.** É o mesmo princípio do
 *     `aggregateByCategory`: documento cuja operadora não foi identificada é
 *     justamente o que precisa de atenção, e esconder a linha esconderia o
 *     trabalho pendente.
 *
 *  3. **Toda célula carrega os `transactionIds`.** A tela cruzada é onde mais
 *     dá vontade de perguntar "quais gastos são esses?" — sem os ids, a
 *     resposta exigiria recalcular por outro caminho.
 */
export function aggregateByIssuerMonth(entries: IssuedTransaction[]): IssuerMonthMatrix {
  const counted = spendable(entries);

  const months = [...new Set(counted.map((entry) => entry.date.slice(0, 7)))].sort((a, b) =>
    b.localeCompare(a),
  );
  const monthIndex = new Map(months.map((month, position) => [month, position]));

  const byIssuer = new Map<string | null, Array<Bucket | null>>();
  const monthTotals: Bucket[] = months.map(() => emptyBucket());
  const total = emptyBucket();

  for (const entry of counted) {
    const position = monthIndex.get(entry.date.slice(0, 7))!;
    const issuer = entry.issuer ?? null;

    const row = byIssuer.get(issuer) ?? months.map(() => null);
    row[position] = add(row[position] ?? emptyBucket(), entry);
    byIssuer.set(issuer, row);

    monthTotals[position] = add(monthTotals[position]!, entry);
    add(total, entry);
  }

  return {
    months,
    issuers: [...byIssuer.entries()]
      .map(([issuer, byMonth]) => ({
        issuer,
        total: byMonth.reduce<Bucket>(
          (sum, cell) =>
            cell === null
              ? sum
              : {
                  value: sum.value + cell.value,
                  transactionIds: [...sum.transactionIds, ...cell.transactionIds],
                  count: sum.count + cell.count,
                },
          emptyBucket(),
        ),
        byMonth,
      }))
      .sort((a, b) => b.total.value - a.total.value),
    monthTotals,
    total,
  };
}

function emptyBucket(): Bucket {
  return { value: 0, transactionIds: [], count: 0 };
}

function add(bucket: Bucket, entry: Transaction): Bucket {
  bucket.value += entry.amount;
  bucket.transactionIds.push(entry.id);
  bucket.count += 1;
  return bucket;
}

export type Recurrence = Provenance & {
  merchant: string;
  /** Quantas COBRANÇAS, não quantas linhas: o IOF anda junto da compra. */
  occurrences: number;
  /** Valor da cobrança mais recente, em centavos, encargos incluídos. */
  latestAmount: number;
  /** Valor da primeira cobrança observada, encargos incluídos. */
  firstAmount: number;
  /** Variação entre a primeira e a última, ou `null` se a primeira era zero. */
  priceChangeRatio: number | null;
  /** Intervalo mediano entre cobranças, em dias. */
  medianIntervalDays: number;
  /** Projeção anual: valor mais recente na cadência mediana observada. */
  annualizedCents: number;
  /**
   * `false` quando só há duas cobranças. Duas cobranças a 31 dias são um
   * padrão PROVÁVEL, não um fato — e quem lê precisa saber a diferença.
   */
  confirmed: boolean;
};

/** Uma cobrança: a compra mais os encargos que ela gerou no mesmo dia. */
type Charge = { date: string; amount: number; transactionIds: string[] };

/**
 * Cobranças que se repetem no mesmo comerciante.
 *
 * O critério é intervalo regular, não valor igual: assinatura que reajustou
 * continua sendo assinatura — e é justamente a que interessa apontar.
 *
 * Três decisões que vieram de errar contra dados reais:
 *
 *  1. **Agrupa por identidade, não pelo texto impresso.** O emissor escreve o
 *     mesmo comerciante de formas diferentes a cada fatura; agrupar pela
 *     string fazia cada assinatura virar duas entradas de uma cobrança só, e
 *     nenhuma atingia o mínimo.
 *
 *  2. **O IOF não é uma cobrança.** Ele entra na MESMA cobrança que o gerou.
 *     Antes, cada assinatura internacional tinha o dobro de linhas — o que
 *     passava no mínimo de ocorrências — mas com intervalos `[0, 31, 0]`, cuja
 *     mediana é zero, fora da janela mensal. Resultado: Claude, OpenAI,
 *     Cursor, GitHub e DigitalOcean, que são justamente as recorrências mais
 *     caras, eram as únicas que nunca apareciam.
 *
 *  3. **O mínimo é 2, marcado como não confirmado.** Exigir 3 significa não
 *     responder nada até a terceira fatura. Com duas faturas o padrão já é
 *     visível; o que não se pode é apresentá-lo com a mesma segurança.
 */
export function detectRecurrences(
  transactions: Transaction[],
  options: { minOccurrences?: number; merchantAliases?: string[][] } = {},
): Recurrence[] {
  const minOccurrences = options.minOccurrences ?? 2;

  const counted = spendable(transactions).filter(
    (transaction) => identityOf(transaction) !== null,
  );

  // Agrupa as grafias equivalentes antes de qualquer contagem.
  const cluster = clusterMerchantKeys(
    counted.map((t) => identityOf(t)!),
    options.merchantAliases ?? [],
  );
  const byIdentity = new Map<string, Transaction[]>();

  for (const transaction of counted) {
    const identity = cluster.get(identityOf(transaction)!)!;
    byIdentity.set(identity, [...(byIdentity.get(identity) ?? []), transaction]);
  }

  const recurrences: Recurrence[] = [];

  for (const group of byIdentity.values()) {
    const charges = toCharges(group);
    if (charges.length < minOccurrences) continue;

    const intervals: number[] = [];
    for (let index = 1; index < charges.length; index += 1) {
      intervals.push(daysBetween(charges[index - 1]!.date, charges[index]!.date));
    }

    const medianInterval = median(intervals);
    // Entre 3 e 5 semanas cobre mensal com variação de dia de fechamento.
    if (medianInterval < 21 || medianInterval > 38) continue;

    const first = charges[0]!;
    const latest = charges[charges.length - 1]!;

    recurrences.push({
      // O rótulo é o texto que a pessoa reconhece, não a chave interna. Vem da
      // cobrança mais recente: é a grafia que ela acabou de ver na fatura.
      merchant: labelOf(group),
      occurrences: charges.length,
      value: charges.reduce((sum, charge) => sum + charge.amount, 0),
      transactionIds: charges.flatMap((charge) => charge.transactionIds),
      firstAmount: first.amount,
      latestAmount: latest.amount,
      priceChangeRatio: first.amount === 0 ? null : (latest.amount - first.amount) / first.amount,
      medianIntervalDays: medianInterval,
      // Projeção anual pela cadência mediana OBSERVADA, não por "×12": a
      // janela aceita intervalos de 21 a 38 dias, e uma cobrança a cada 38
      // dias tem ~9,6 ocorrências por ano — o multiplicador fixo inflava o
      // número em até 25%.
      annualizedCents: Math.round(latest.amount * (365 / medianInterval)),
      confirmed: charges.length >= 3,
    });
  }

  return recurrences.sort((a, b) => b.annualizedCents - a.annualizedCents);
}

/**
 * Colapsa encargos na compra do mesmo dia.
 *
 * O IOF de uma assinatura internacional é lançado como linha própria, na mesma
 * data e com o mesmo comerciante. Ele é parte do custo — entra no valor — mas
 * não é um evento de cobrança e não pode contar como intervalo.
 *
 * Um encargo sem compra no mesmo dia vira cobrança por si: é anuidade, juros,
 * multa. Descartá-lo esconderia dinheiro que saiu.
 */
function toCharges(group: Transaction[]): Charge[] {
  const byDate = new Map<string, Charge>();

  for (const transaction of [...group].sort((a, b) => a.date.localeCompare(b.date))) {
    const existing = byDate.get(transaction.date);
    if (existing === undefined) {
      byDate.set(transaction.date, {
        date: transaction.date,
        amount: transaction.amount,
        transactionIds: [transaction.id],
      });
      continue;
    }
    existing.amount += transaction.amount;
    existing.transactionIds.push(transaction.id);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** A chave persistida quando existe; o texto cru normalizado quando não. */
function identityOf(transaction: Transaction): string | null {
  if (transaction.merchantKey !== null && transaction.merchantKey !== undefined) {
    return transaction.merchantKey;
  }
  return merchantKey(transaction);
}

function labelOf(group: Transaction[]): string {
  const latest = [...group].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
  return latest.merchant ?? latest.originalDescription;
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;
}
