import { getDb } from "@clara-financas/db";
import { documents, transactions } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { issuerKey, type Confidence, type EntryKind, type Transaction } from "@clara-financas/ledger";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { categoryLabel, type CategoryLabels } from "./categories";

/**
 * Recorte do razão.
 *
 * `batchId` existe porque o razão era um pool achatado, filtrável só por data
 * — e fatura NÃO é intervalo de datas. Um ciclo que fecha em 07/07 cobre
 * compras de 31/05 a 30/06, e duas faturas consecutivas se tocam na virada.
 * Sem esta dimensão, "nesta fatura" era literalmente inexprimível no sistema
 * inteiro: a pessoa perguntava sobre um documento e recebia a soma de todos.
 */
export type LedgerRange = {
  from?: string;
  to?: string;
  /** Restringe a UMA fatura, pelo id do lote que a registrou. */
  batchId?: string;
  /**
   * Inclui o lote em rascunho na leitura. Só faz sentido junto de `batchId`.
   *
   * Existe porque a exclusão de `proposed` tinha um efeito colateral que
   * inviabilizava o trabalho principal do produto: uma fatura EM CONFERÊNCIA
   * está, por definição, em rascunho. A pessoa perguntava "onde está a
   * diferença desta fatura?", a coordenadora — proibida de calcular sozinha —
   * delegava ao analista, e o analista consultava um razão onde aquele lote
   * não existia. Voltava vazio, e a conversa terminava em desculpa.
   *
   * O cuidado que justificava a exclusão continua de pé e é outro: rascunho
   * não entra em AGREGAÇÃO do razão (total do mês, comparação, recorrência),
   * porque ali ele viraria fato. Quem liga isto devolve o `status` junto, para
   * que a resposta possa dizer que aquilo ainda espera decisão.
   */
  includeProposed?: boolean;
  /**
   * Texto procurado na descrição crua ou no comerciante.
   *
   * Vai ao BANCO, não à memória. Antes era um `includes()` aplicado depois de
   * carregar o razão inteiro: além de não escalar, exigia acerto exato de
   * acentuação e caixa, e casava só a frase inteira — "descrição próxima a
   * pagamento" não achava "PAGTO FATURA" nem "Pagamento efetuado". Aqui a
   * comparação é sem acento, sem caixa, e por TERMO: qualquer palavra da busca
   * que apareça já traz a linha.
   */
  search?: string;
  /** Natureza da linha: compra, pagamento, estorno, encargo, ajuste. */
  kinds?: readonly EntryKind[];
  /** Confiança da extração, para achar o que foi lido com dúvida. */
  confidences?: readonly Confidence[];
  /** `true` = só o já revisado por uma pessoa; `false` = só o que falta. */
  reviewed?: boolean;
  /** `false` = só o que está sem categoria. */
  hasCategory?: boolean;
  /** Categoria exata, pelo identificador. */
  category?: string;
  /** Restringe a um conjunto de ids — a resposta de "de onde veio este número". */
  ids?: readonly string[];
  /**
   * Nome da operadora/cartão, como a pessoa fala ("Nubank", "Itaú").
   *
   * Não existia, e "quanto gastei no Nubank" era irrespondível por construção:
   * `documents.issuer` só saía como campo de resposta, nunca entrava como
   * filtro. A comparação usa `issuerKey` — a MESMA chave da visão por operadora
   * da web — então "Nubank" e "nu bank" são a mesma operadora aqui e lá.
   */
  issuer?: string;
};

/**
 * Comparação de texto sem acento e sem caixa, no banco.
 *
 * `translate` em vez de `unaccent()`: é função nativa e imutável, não depende
 * de extensão instalada nem de privilégio de superusuário para funcionar em
 * qualquer Postgres gerenciado — e, por ser imutável, aceita índice de
 * expressão. A tabela de origem e a de destino têm o mesmo número de
 * caracteres; mudar uma exige mudar a outra.
 */
const ACCENTED = "áàâãäéèêëíìîïóòôõöúùûüçñ";
const PLAIN = "aaaaaeeeeiiiiooooouuuucn";

function unaccentLower(column: PgColumn): SQL {
  return sql`translate(lower(coalesce(${column}, '')), ${ACCENTED}, ${PLAIN})`;
}

/** Marcas de acento, para tirar o acento do lado JS igual ao lado SQL. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Divide a busca em termos; casar qualquer um deles já traz a linha. */
function searchTerms(search: string): string[] {
  return search
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3);
}

/**
 * Linha do razão como o agente a enxerga.
 *
 * Superset de `Transaction` (o tipo puro do domínio, que alimenta checksum e
 * agregações) com os três campos operacionais que o modelo precisa para
 * RACIOCINAR sobre a linha, e que antes eram descartados na fronteira: em que
 * estado ela está, de que fatura veio, e se alguém já a revisou.
 */
export type LedgerEntry = Transaction & {
  status: "proposed" | "confirmed" | "adjustment";
  batchId: string;
  reviewedAt: string | null;
};

/**
 * Carrega transações do razão, no escopo do tenant.
 *
 * Por padrão só o que está CONFIRMADO (mais os ajustes): análise sobre lote não
 * aprovado apresentaria como fato algo que a pessoa ainda não confirmou. Ver
 * `includeProposed` para a exceção — e por que ela existe.
 */
export async function loadLedger(
  tenantId: string,
  range: LedgerRange = {},
): Promise<LedgerEntry[]> {
  const statuses =
    range.includeProposed === true
      ? (["confirmed", "adjustment", "proposed"] as const)
      : (["confirmed", "adjustment"] as const);

  const filters: SQL[] = [
    eq(transactions.tenantId, tenantId),
    inArray(transactions.status, [...statuses]),
  ];
  if (range.from !== undefined) filters.push(gte(transactions.date, range.from));
  if (range.to !== undefined) filters.push(lte(transactions.date, range.to));
  if (range.batchId !== undefined) filters.push(eq(transactions.batchId, range.batchId));
  if (range.ids !== undefined) filters.push(inArray(transactions.id, [...range.ids]));
  if (range.kinds !== undefined && range.kinds.length > 0) {
    filters.push(inArray(transactions.kind, [...range.kinds]));
  }
  if (range.confidences !== undefined && range.confidences.length > 0) {
    filters.push(inArray(transactions.extractionConfidence, [...range.confidences]));
  }
  if (range.reviewed !== undefined) {
    filters.push(
      range.reviewed ? isNotNull(transactions.reviewedAt) : isNull(transactions.reviewedAt),
    );
  }
  if (range.category !== undefined) filters.push(eq(transactions.category, range.category));
  if (range.hasCategory !== undefined) {
    filters.push(
      range.hasCategory ? isNotNull(transactions.category) : isNull(transactions.category),
    );
  }
  if (range.search !== undefined) {
    const terms = searchTerms(range.search);
    // Busca sem termo aproveitável (só palavrinhas curtas) não pode virar
    // "tudo": devolver o razão inteiro como se fosse resultado é pior do que
    // devolver nada, porque parece uma resposta.
    const matches = terms.flatMap((term) => [
      sql`${unaccentLower(transactions.originalDescription)} like ${`%${term}%`}`,
      sql`${unaccentLower(transactions.merchant)} like ${`%${term}%`}`,
    ]);
    filters.push(matches.length > 0 ? or(...matches)! : sql`false`);
  }

  const rows = await forTenant(
    tenantId,
    async (tx) => {
      if (range.issuer !== undefined) {
        // A grafia do banco não é a grafia da pergunta: resolve-se por
        // `issuerKey`, comparando em JS sobre os documentos do tenant (poucos,
        // por construção — um por fatura). Nenhum match vira `sql\`false\``:
        // devolver o razão inteiro como se fosse a operadora pedida é pior que
        // devolver vazio, porque parece uma resposta.
        const wanted = issuerKey(range.issuer);
        const docs = await tx
          .select({ id: documents.id, issuer: documents.issuer })
          .from(documents)
          .where(eq(documents.tenantId, tenantId));
        const matching = docs
          .filter((doc) => issuerKey(doc.issuer) === wanted)
          .map((doc) => doc.id);
        filters.push(
          matching.length > 0
            ? inArray(transactions.sourceDocumentId, matching)
            : sql`false`,
        );
      }

      // Ordem estável (data recente primeiro, id como desempate): quem trunca o
      // resultado com slice precisa que duas chamadas iguais mostrem as MESMAS
      // linhas — sem ORDER BY, as 100 exibidas eram arbitrárias e mudavam entre
      // consultas idênticas.
      return tx
        .select()
        .from(transactions)
        .where(and(...filters))
        .orderBy(desc(transactions.date), desc(transactions.id));
    },
    getDb(),
  );

  return rows.map(toDomain);
}

/**
 * A operadora de cada documento, para compor com as linhas do razão.
 *
 * A operadora não vive na transação: é do DOCUMENTO (`documents.issuer`), e o
 * domínio a recebe por composição justamente para que duas linhas da mesma
 * fatura não possam discordar sobre de onde vieram (ver `IssuedTransaction` em
 * `@clara-financas/ledger`). Uma consulta separada é barata pelo mesmo motivo
 * que o filtro por operadora já usa: há um documento por fatura, não um por
 * lançamento.
 */
export async function loadIssuersByDocument(
  tenantId: string,
): Promise<Map<string, string | null>> {
  const rows = await forTenant(
    tenantId,
    async (tx) =>
      tx
        .select({ id: documents.id, issuer: documents.issuer })
        .from(documents)
        .where(eq(documents.tenantId, tenantId)),
    getDb(),
  );

  return new Map(rows.map((row) => [row.id, row.issuer]));
}

/**
 * Que períodos o razão de fato cobre.
 *
 * Serve para responder vazio de forma útil. Um recorte sem dados é ambíguo: o
 * razão está vazio, ou a pergunta pegou o mês errado? Sem essa informação o
 * modelo conclui "não há nada registrado" e manda a pessoa reenviar uma fatura
 * que já está lá — observado na prática, quando ele filtrou por julho e as
 * transações eram do ciclo 31/05–30/06.
 */
export async function ledgerCoverage(
  tenantId: string,
): Promise<{ count: number; firstDate: string | null; lastDate: string | null }> {
  const rows = await forTenant(
    tenantId,
    async (tx) =>
      tx
        .select({
          count: sql<number>`count(*)::int`,
          firstDate: sql<string | null>`min(${transactions.date})`,
          lastDate: sql<string | null>`max(${transactions.date})`,
        })
        .from(transactions)
        .where(
          and(
            // RLS já escopa; o eq explícito é defesa em profundidade, no mesmo
            // padrão do resto do código — uma agregação global silenciosa é o
            // pior jeito de descobrir que a conexão errada desligou a RLS.
            eq(transactions.tenantId, tenantId),
            inArray(transactions.status, ["confirmed", "adjustment"]),
          ),
        ),
    getDb(),
  );

  return rows[0] ?? { count: 0, firstDate: null, lastDate: null };
}

/** Traduz a linha do banco para o tipo do domínio, que é o que o ledger usa. */
export function toDomain(row: typeof transactions.$inferSelect): LedgerEntry {
  return {
    status: row.status,
    batchId: row.batchId,
    // O atestado de revisão viaja como data ISO: o modelo compara e ordena
    // texto, e um Date atravessando a fronteira vira `{}` no JSON da tool.
    reviewedAt: row.reviewedAt === null ? null : row.reviewedAt.toISOString(),
    id: row.id,
    date: row.date,
    originalDescription: row.originalDescription,
    merchant: row.merchant,
    amount: row.amount,
    kind: row.kind,
    merchantKey: row.merchantKey,
    installment:
      row.installmentCurrent !== null && row.installmentTotal !== null
        ? { current: row.installmentCurrent, total: row.installmentTotal }
        : null,
    category: row.category,
    extractionConfidence: row.extractionConfidence,
    sourceDocument: row.sourceDocumentId,
    page: row.page,
  };
}

/**
 * Resumo enviado ao modelo para uma transação.
 *
 * Enxuto por contexto, mas não amputado: os campos abaixo são o que permite
 * RACIOCINAR sobre a linha, e a falta deles produzia respostas erradas com
 * cara de certas. Sem `kind`, a Clara não conseguia ver que uma linha é
 * pagamento de fatura — e pagamento não compõe o total (`countsTowardDeclaredTotal`),
 * então "categorize os pagamentos" era literalmente impossível de executar.
 * Sem `extractionConfidence` ela não sabia o que a extração marcou como
 * duvidoso; sem `reviewedAt`, devolvia para revisão o que a pessoa já conferiu;
 * sem `status`, apresentava rascunho como razão.
 *
 * O que continua de fora é o que o modelo não usa para decidir: `merchantKey`
 * (chave interna), `sourceDocument` e os campos de parcela, que viajam só
 * quando a resposta é sobre o documento.
 */
export function brief(entry: LedgerEntry, labels: CategoryLabels = {}) {
  return {
    id: entry.id,
    date: entry.date,
    description: entry.originalDescription,
    merchant: entry.merchant,
    amountCents: entry.amount,
    kind: entry.kind,
    category: entry.category,
    // O rótulo vai junto para o modelo escrever "Restaurantes" e não "dining".
    categoryLabel: categoryLabel(labels, entry.category),
    confidence: entry.extractionConfidence,
    status: entry.status,
    batchId: entry.batchId,
    reviewed: entry.reviewedAt !== null,
    page: entry.page,
  };
}
