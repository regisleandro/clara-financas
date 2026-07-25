/**
 * Regras de categorização aprendidas.
 *
 * Vive aqui, e não na tool, porque decidir a categoria de um lançamento é
 * decisão de domínio: precisa ser pura, determinística e testável. Uma regra
 * que categoriza errado é indistinguível de um número errado — contamina toda
 * análise que vier depois, e sem teste ninguém descobre.
 */

export type LearnedRule = {
  conceptId: string;
  /** Trecho estável que identifica o lançamento, em minúsculas. */
  matcher: string;
  /** Identificador da categoria, extraído do link markdown do corpo. */
  category: string;
};

export type RuleCandidate = {
  conceptId: string;
  frontmatter: Record<string, unknown>;
  body: string;
};

export type RuleTarget = {
  id: string;
  merchant: string | null;
  originalDescription: string;
};

export type RuleMatch = {
  transactionId: string;
  description: string;
  category: string;
  byConceptId: string;
};

/**
 * O corpo referencia a categoria por link markdown ABSOLUTO — é a sintaxe de
 * cross-link do OKF (§6.1), não invenção nossa. Guardar o id da categoria num
 * campo do frontmatter seria mais simples de ler, mas quebraria a portabilidade:
 * o bundle exportado deixaria de ser navegável como markdown.
 */
const CATEGORY_LINK = /\]\(\/categories\/([a-z0-9-]+)\.md\)/;

/**
 * Converte conceitos crus em regras aplicáveis. Conceito malformado é
 * descartado em silêncio, não derruba o lote: o OKF manda tolerar link
 * quebrado (§11), e uma regra ruim não pode impedir as boas de rodarem.
 */
export function parseRules(candidates: readonly RuleCandidate[]): LearnedRule[] {
  return candidates.flatMap((candidate) => {
    const raw = candidate.frontmatter.merchant ?? candidate.frontmatter.title;
    const link = CATEGORY_LINK.exec(candidate.body);
    if (typeof raw !== "string" || link === null) return [];

    const matcher = raw.trim().toLowerCase();
    if (matcher === "") return [];

    return [{ conceptId: candidate.conceptId, matcher, category: link[1]! }];
  });
}

/**
 * Casa regras contra lançamentos. Primeira regra que casa vence — e por isso a
 * ordem importa: regras mais específicas devem vir antes. Não há ranking por
 * "melhor casamento" de propósito; escolha implícita entre duas regras que
 * ambas casam é exatamente o tipo de comportamento que a pessoa não consegue
 * prever nem auditar.
 */
export function matchRules(
  rules: readonly LearnedRule[],
  targets: readonly RuleTarget[],
): RuleMatch[] {
  return targets.flatMap((target) => {
    const haystack = `${target.merchant ?? ""} ${target.originalDescription}`.toLowerCase();
    const rule = rules.find((candidate) => haystack.includes(candidate.matcher));
    if (rule === undefined) return [];

    return [
      {
        transactionId: target.id,
        description: target.merchant ?? target.originalDescription,
        category: rule.category,
        byConceptId: rule.conceptId,
      },
    ];
  });
}
