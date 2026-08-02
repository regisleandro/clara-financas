/**
 * Tradução de identificador de categoria para o nome que a pessoa lê.
 *
 * O identificador é inglês por decisão de projeto (código em inglês, interface
 * em português) — `groceries`, `dining`. O nome em português já existe no
 * `title` do conceito da constituição: "Mercado", "Restaurantes".
 *
 * A função é PURA e vive no ledger porque tanto o agente quanto o web
 * precisam dela — deixá-la no pacote do agente obrigava o dashboard a mostrar
 * o identificador cru ("dining" num produto inteiro em português). O loader
 * que consulta o banco fica em `@clara-financas/db/category-labels`.
 */
export type CategoryLabels = Readonly<Record<string, string>>;

/**
 * Aplica o rótulo, com queda para o próprio identificador.
 *
 * Categoria sem conceito correspondente é possível — uma regra aprendida pode
 * apontar para uma categoria que foi removida depois. Mostrar o identificador
 * cru é feio, mas é honesto e não esconde a inconsistência; inventar um nome
 * bonito esconderia.
 *
 * A busca normaliza o que RECEBE, e não só o que o mapa guarda. O docblock de
 * `categorySlug` já dizia que as duas formas são aceitas "porque a origem do
 * dado não deve decidir se a tradução funciona" — mas a intenção estava só de
 * um lado: `loadCategoryLabels` normalizava as CHAVES e esta função procurava
 * pela string crua. Um lançamento gravado com o caminho do conceito
 * (`categories/entertainment`, que é o que o modelo tem em mãos logo depois de
 * criar a categoria) errava a busca e ia para a tela como caminho.
 */
export function categoryLabel(labels: CategoryLabels, category: string | null): string {
  if (category === null) return "Sem categoria";
  return labels[categorySlug(category)] ?? labels[category] ?? category;
}

/**
 * O identificador da categoria a partir do id do conceito.
 *
 * O conceito OKF é identificado pelo CAMINHO no bundle (`categories/groceries`)
 * e o razão guarda só o slug (`groceries`). A conversão estava copiada em
 * quatro arquivos, cada um com a sua regex — e quatro cópias de uma regra são
 * quatro chances de uma divergir. Aceitar as duas formas é deliberado: o id
 * chega ora do conceito, ora do razão, e a origem do dado não deve decidir se
 * a tradução funciona.
 */
export function categorySlug(conceptId: string): string {
  return conceptId.startsWith("categories/") ? conceptId.slice("categories/".length) : conceptId;
}
