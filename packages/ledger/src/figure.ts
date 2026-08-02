/**
 * Um número que sabe como foi construído.
 *
 * O kernel sempre devolveu `Provenance` — valor mais os ids que o compõem — e
 * a promessa do produto é que todo número exibido possa ser conferido. A
 * promessa vinha se perdendo uma camada acima: as tools do analista montavam o
 * valor por um caminho e os ids por outro, e nada nunca confrontava os dois.
 * `ViewSchema` chegava a validar que os ids EXISTEM, nunca que eles EXPLICAM o
 * número — é um cinto que confere se você está usando cinto, não se ele está
 * preso.
 *
 * Os defeitos que isso produziu não eram exóticos:
 *
 *  - uma diferença entre dois períodos carregando a UNIÃO dos ids dos dois
 *    lados, como se a subtração fosse uma soma;
 *  - um custo anualizado (projeção de 365 dias) carregando os ids das cobranças
 *    reais, que somam outra coisa;
 *  - linhas de categoria que não somavam o número em destaque logo acima delas.
 *
 * Nenhum deles é detectável olhando só o valor, e todos são óbvios quando a
 * FÓRMULA viaja junto. É isso que `basis` faz: o número deixa de ser um
 * inteiro solto e passa a dizer se é uma soma, uma diferença, uma projeção, um
 * fato do documento ou uma contagem — e cada uma dessas formas tem uma equação
 * que `reconcile` sabe verificar contra o razão.
 *
 * `delta` e `projection` não são exceções à regra "todo número reconstrói".
 * São outras equações da MESMA regra. A diferença é que a fórmula agora mora
 * no dado, e não num comentário ao lado do código que a implementa.
 *
 * Dinheiro continua inteiro em centavos, sempre. Ver `./types`.
 */

/** O mínimo que uma linha precisa ter para entrar numa soma. */
export type Countable = { id: string; amount: number };

export type Basis =
  /** Soma direta dos lançamentos apontados por `transactionIds`. */
  | { kind: "sum" }
  /** Diferença entre duas figuras — variação entre períodos, líquido, etc. */
  | { kind: "delta"; minuend: Figure; subtrahend: Figure }
  /** Estimativa derivada de uma figura real por um fator declarado. */
  | { kind: "projection"; factor: number; base: Figure }
  /** Fato do documento (total declarado, saldo). Não tem lançamento por trás. */
  | { kind: "document" }
  /** Não é dinheiro — uma contagem. Nunca deve ser formatado como moeda. */
  | { kind: "count" };

export type Figure = {
  /** Centavos, exceto quando `basis.kind === "count"`. */
  value: number;
  transactionIds: string[];
  basis: Basis;
};

/**
 * Construtores.
 *
 * São a única porta de entrada de propósito: nenhum aceita `value` solto. Um
 * número só existe aqui se veio de lançamentos ou de uma operação declarada
 * sobre outra figura — que é como a fórmula deixa de depender de alguém
 * lembrar de escrevê-la.
 */
export function sumOf(transactions: readonly Countable[]): Figure {
  return {
    value: transactions.reduce((total, entry) => total + entry.amount, 0),
    transactionIds: transactions.map((entry) => entry.id),
    basis: { kind: "sum" },
  };
}

/**
 * `minuend − subtrahend`.
 *
 * Os ids são a UNIÃO dos dois lados, e isso é correto justamente porque o
 * `basis` diz que são de uma diferença: quem confere sabe que precisa separar
 * os lados antes de somar. Era a mesma união de antes — mas antes ela ia
 * anexada a um valor que se apresentava como soma.
 */
export function deltaOf(minuend: Figure, subtrahend: Figure): Figure {
  return {
    value: minuend.value - subtrahend.value,
    transactionIds: [...new Set([...minuend.transactionIds, ...subtrahend.transactionIds])],
    basis: { kind: "delta", minuend, subtrahend },
  };
}

/**
 * `base × factor`, arredondado para centavos.
 *
 * O fator fica guardado para poder ser RENDERIZADO. Um custo anual projetado a
 * partir de três cobranças não é o que aquelas três cobranças somam, e a tela
 * precisa poder dizer isso.
 */
export function project(base: Figure, factor: number): Figure {
  if (!Number.isFinite(factor)) {
    throw new Error(`fator de projeção precisa ser finito; recebeu ${factor}`);
  }
  return {
    value: Math.round(base.value * factor),
    transactionIds: [...base.transactionIds],
    basis: { kind: "projection", factor, base },
  };
}

/** Um número que o DOCUMENTO declara. Sem lançamentos por trás, por natureza. */
export function documentFact(value: number): Figure {
  return { value, transactionIds: [], basis: { kind: "document" } };
}

/**
 * Uma contagem — "6 assinaturas".
 *
 * Existe para que a interface pare de ADIVINHAR. Havia uma heurística de regex
 * sobre o rótulo decidindo se um número era dinheiro; ela transformava
 * `{ label: "Total de assinaturas", text: "6" }` em `R$ 0,06`, e a gêmea dela
 * no schema recusava o painel inteiro. Com o tipo declarado não há o que
 * adivinhar.
 */
export function countOf(value: number): Figure {
  return { value, transactionIds: [], basis: { kind: "count" } };
}

export type Violation = {
  /** Onde no painel, para a mensagem de erro apontar o lugar certo. */
  path: string;
  reason:
    | "soma_nao_confere"
    | "lancamento_desconhecido"
    | "diferenca_nao_confere"
    | "ids_da_diferenca"
    | "projecao_nao_confere"
    | "fato_com_lancamento";
  expected: number;
  got: number;
};

/**
 * A figura reconstrói o próprio valor a partir do razão?
 *
 * `amountsById` é a TESTEMUNHA: os lançamentos que o chamador realmente leu do
 * banco para montar aquele painel. Confrontar contra ela é o que distingue
 * "os ids existem" de "os ids explicam o número" — e é a única checagem que um
 * schema Zod não tem como fazer, porque schema não tem acesso ao razão.
 *
 * Devolve a lista de violações, vazia quando está tudo certo. Lista e não
 * exceção: um painel pode ter mais de um número errado, e ver todos de uma vez
 * é o que torna o conserto uma tarefa só.
 */
export function reconcile(
  figure: Figure,
  amountsById: ReadonlyMap<string, number>,
  path = "figure",
): Violation[] {
  const violations: Violation[] = [];

  switch (figure.basis.kind) {
    case "sum": {
      let total = 0;
      for (const id of figure.transactionIds) {
        const amount = amountsById.get(id);
        if (amount === undefined) {
          violations.push({
            path,
            reason: "lancamento_desconhecido",
            expected: 0,
            got: 0,
          });
          continue;
        }
        total += amount;
      }
      if (violations.length === 0 && total !== figure.value) {
        violations.push({
          path,
          reason: "soma_nao_confere",
          expected: total,
          got: figure.value,
        });
      }
      return violations;
    }

    case "delta": {
      const { minuend, subtrahend } = figure.basis;
      violations.push(...reconcile(minuend, amountsById, `${path}.minuendo`));
      violations.push(...reconcile(subtrahend, amountsById, `${path}.subtraendo`));

      const expected = minuend.value - subtrahend.value;
      if (expected !== figure.value) {
        violations.push({ path, reason: "diferenca_nao_confere", expected, got: figure.value });
      }

      // Os ids precisam ser exatamente a união dos dois lados. Sem isto, uma
      // diferença poderia arrastar proveniência de um terceiro lugar.
      const union = new Set([...minuend.transactionIds, ...subtrahend.transactionIds]);
      const declared = new Set(figure.transactionIds);
      if (union.size !== declared.size || [...union].some((id) => !declared.has(id))) {
        violations.push({
          path,
          reason: "ids_da_diferenca",
          expected: union.size,
          got: declared.size,
        });
      }
      return violations;
    }

    case "projection": {
      const { base, factor } = figure.basis;
      violations.push(...reconcile(base, amountsById, `${path}.base`));
      const expected = Math.round(base.value * factor);
      if (expected !== figure.value) {
        violations.push({ path, reason: "projecao_nao_confere", expected, got: figure.value });
      }
      return violations;
    }

    case "document":
    case "count": {
      // Não há razão por trás — e justamente por isso NÃO pode carregar ids:
      // um fato do documento com proveniência anexada é um número que finge ser
      // derivado do razão quando não é.
      if (figure.transactionIds.length > 0) {
        violations.push({
          path,
          reason: "fato_com_lancamento",
          expected: 0,
          got: figure.transactionIds.length,
        });
      }
      return violations;
    }
  }
}

/**
 * As linhas somam o número em destaque?
 *
 * A checagem que faltava e que a pessoa fazia de cabeça: somar as linhas do
 * painel e comparar com o valor grande em cima delas. Quando não batia — e não
 * batia, por 20 reais num painel de 130 — a conclusão razoável era que nenhum
 * dos dois números merecia confiança.
 *
 * Só vale para painéis ADITIVOS, em que as linhas são partes de um todo. Numa
 * comparação as linhas são diferenças por categoria e o topo é a diferença
 * total: também somam, mas cada lado é uma `delta`, e quem verifica isso é
 * `reconcile`.
 */
export function rowsSumToMetric(metric: Figure, rows: readonly Figure[]): Violation[] {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (total === metric.value) return [];
  return [{ path: "metric", reason: "soma_nao_confere", expected: total, got: metric.value }];
}

/** A testemunha, no formato que `reconcile` consome. */
export function witnessOf(transactions: readonly Countable[]): ReadonlyMap<string, number> {
  return new Map(transactions.map((entry) => [entry.id, entry.amount]));
}
