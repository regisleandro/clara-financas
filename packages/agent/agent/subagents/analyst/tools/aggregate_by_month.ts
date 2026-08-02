import { aggregateByIssuerMonth, formatCents, formatMonthLabel } from "@clara-financas/ledger";
import type { AnalysisScope } from "@clara-financas/views/agent-contracts";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { canonicalAnalysisScope, draftNote, scopeFilter } from "../../../lib/analysis-scope";
import { optionalText } from "../../../lib/schema";
import { requireTenantCaller } from "../../../lib/tenant";
import { ledgerCoverage, loadIssuersByDocument, loadLedger } from "../../../lib/ledger-query";
import { saveAnalysis } from "../lib/save-analysis";

/**
 * O gasto mês a mês, e por operadora dentro de cada mês.
 *
 * Faltava — e a falta não parecia falta. `aggregate_by_category` recorta UM
 * período; `compare_periods` compara DOIS; `analyze_series` compara os períodos
 * que o chamador SOUBER nomear. Uma pergunta como "quanto gastei em cada mês"
 * não tinha caminho: exigia adivinhar quantos meses existem e pedir um por vez,
 * e a resposta terminava sendo a soma de várias chamadas — feita pelo modelo,
 * que é exatamente onde os números param de fechar.
 *
 * A conta é a MESMA da tela cruzada por operadora (`aggregateByIssuerMonth`, em
 * `@clara-financas/ledger`), que até aqui só a web alcançava. É o caso repetido
 * da fila de revisão atrás de `server-only`: a resposta existia na aba ao lado e
 * a conversa dizia que não sabia. Reimplementar a agregação daria dois números
 * para a mesma pergunta — a tela mostrando um, a Clara falando outro.
 *
 * O mês é o da COMPRA, não o do fechamento da fatura: uma fatura que fecha em
 * julho cobre gastos de maio e junho, e jogá-los em julho deixaria maio vazio.
 *
 * Publica pelo mesmo gargalo das outras análises (`saveAnalysis`), e não pelo
 * retorno cru. A diferença importa: ali o painel é reconstruído a partir dos
 * lançamentos que esta tool leu, e um mês cujo valor não bate com os próprios
 * ids é recusado antes da tela. Devolver os números para o modelo montar o
 * painel é o desenho que a Fase 2 removeu de todas as demais.
 */
export default defineTool({
  description:
    "Sums spending month by month, and by card issuer within each month. Use for a SERIES — 'mês a mês', 'os últimos meses', 'a evolução do gasto', 'quanto gastei em cada mês'. One call returns every month, each with its own provenance: never ask month by month and never add the months up yourself. The month is the month of PURCHASE, not of the invoice closing. For one period use aggregate_by_category; for exactly two use compare_periods.",
  inputSchema: z.object({
    from: optionalText().describe("Start date, YYYY-MM-DD. Omit for the whole ledger."),
    to: optionalText().describe("End date, YYYY-MM-DD, inclusive."),
    issuer: optionalText().describe(
      "Restrict to one card issuer, as the person says it ('Nubank'). Accent- and case-insensitive.",
    ),
    months: z
      .number()
      .int()
      .min(1)
      .max(36)
      .optional()
      .describe("Keep only the most recent N months of the result. Omit for all of them."),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);

    /*
     * O recorte vira ESCOPO antes de virar consulta.
     *
     * Sem isto o painel nasceria sem escopo declarado, e `saveAnalysis` compara
     * o escopo pedido com o efetivo justamente para que "a resposta é sobre
     * outro período" não seja uma descoberta da pessoa.
     */
    const scope: AnalysisScope = canonicalAnalysisScope(
      input.from !== undefined && input.to !== undefined
        ? { kind: "range", from: input.from, to: input.to, issuer: input.issuer }
        : { kind: "all", issuer: input.issuer },
    ) as AnalysisScope;

    const [ledger, issuers] = await Promise.all([
      loadLedger(tenantId, scopeFilter(scope)),
      loadIssuersByDocument(tenantId),
    ]);

    if (ledger.length === 0) {
      const coverage = await ledgerCoverage(tenantId);
      return saveAnalysis(
        {
          kind: "metric",
          title: "Gasto mês a mês",
          summary:
            coverage.count === 0
              ? "O razão ainda não tem lançamentos confirmados."
              : `Não há lançamentos nesse recorte. O razão cobre de ${coverage.firstDate} a ${coverage.lastDate} (${coverage.count} lançamentos).`,
          metric: {
            label: "Meses com gasto",
            text: "0",
            basis: "count",
            transactionIds: [],
          },
          rows: [],
        },
        scope,
        ctx,
        [],
        ["periodo_vazio"],
      );
    }

    const matrix = aggregateByIssuerMonth(
      ledger.map((entry) => ({ ...entry, issuer: issuers.get(entry.sourceDocument) ?? null })),
    );

    // `months` vem do mais recente para o mais antigo. O corte por `months`
    // acontece ANTES da inversão, para "os últimos 6 meses" pegar os 6 mais
    // recentes e ainda assim ser lido do mais antigo para o mais novo — que é
    // como se lê uma série.
    const keep = input.months ?? matrix.months.length;
    const positions = matrix.months
      .map((_, position) => position)
      .slice(0, keep)
      .reverse();

    const pontos = positions.map((position) => {
      const month = matrix.months[position]!;
      const bucket = matrix.monthTotals[position]!;
      return { month, label: formatMonthLabel(month), bucket, position };
    });

    /*
     * Os ids do DESTAQUE são só os dos meses exibidos.
     *
     * `matrix.total` cobre a matriz inteira; com `months: 6` sobre doze meses de
     * razão, usá-lo poria no topo um total que as seis linhas abaixo não somam —
     * a divergência exata que o guard existe para pegar, e que apareceria como
     * "os números não fecham" para quem só olha a tela.
     */
    const idsExibidos = pontos.flatMap((ponto) => ponto.bucket.transactionIds);
    const totalExibido = pontos.reduce((soma, ponto) => soma + ponto.bucket.value, 0);
    const omitidos = matrix.months.length - pontos.length;

    /*
     * Painel 1 — a série, um mês por linha.
     *
     * `series` e não `breakdown`: as linhas são momentos no tempo. Aqui elas
     * por acaso somam o total (os meses são disjuntos), e por isso o destaque
     * pode ser uma soma honesta com os ids de todos os meses mostrados.
     */
    const painelDaSerie = await saveAnalysis(
      {
        kind: "series",
        title: "Gasto mês a mês",
        summary: `${pontos[0]!.label} → ${pontos.at(-1)!.label}. O mês é o da compra, não o do fechamento da fatura; pagamento de fatura fica fora da soma.${
          omitidos > 0 ? ` ${omitidos} ${omitidos === 1 ? "mês anterior ficou" : "meses anteriores ficaram"} fora do recorte.` : ""
        }${draftNote(ledger)}`,
        metric: {
          label: "Total no período",
          amount: totalExibido,
          detail: `${pontos.length} ${pontos.length === 1 ? "mês" : "meses"}`,
          transactionIds: idsExibidos,
        },
        rows: pontos.map((ponto) => ({
          label: ponto.label,
          amount: ponto.bucket.value,
          detail: `${ponto.bucket.count} ${ponto.bucket.count === 1 ? "lançamento" : "lançamentos"}`,
          transactionIds: ponto.bucket.transactionIds,
        })),
      },
      scope,
      ctx,
      ledger,
    );
    if ("error" in painelDaSerie) return painelDaSerie;

    /*
     * Painel 2 — a composição por operadora, quando há mais de uma.
     *
     * Com uma operadora só o painel repetiria o total da série numa linha, o
     * que é ruído. Com duas ou mais, "o que subiu foi o Nubank" passa a ser uma
     * afirmação com números atrás — e `breakdown` é aditivo, então o guard
     * confere que as operadoras somam o total.
     */
    const porOperadora = matrix.issuers
      .map((row) => {
        const celulas = pontos.flatMap((ponto) => {
          const cell = row.byMonth[ponto.position];
          return cell === null || cell === undefined ? [] : [cell];
        });
        return {
          label: row.issuer ?? "Sem operadora",
          value: celulas.reduce((soma, cell) => soma + cell.value, 0),
          count: celulas.reduce((soma, cell) => soma + cell.count, 0),
          transactionIds: celulas.flatMap((cell) => cell.transactionIds),
        };
      })
      .filter((row) => row.transactionIds.length > 0)
      .sort((a, b) => b.value - a.value);

    if (porOperadora.length < 2) return painelDaSerie;

    const painelPorOperadora = await saveAnalysis(
      {
        kind: "breakdown",
        title: "Por operadora no período",
        summary: `Como o total de ${formatCents(totalExibido)} se divide entre as operadoras.`,
        metric: {
          label: "Total no período",
          amount: totalExibido,
          transactionIds: idsExibidos,
        },
        rows: porOperadora.map((row) => ({
          label: row.label,
          amount: row.value,
          detail: `${row.count} ${row.count === 1 ? "lançamento" : "lançamentos"}`,
          share: totalExibido === 0 ? undefined : Math.min(1, Math.abs(row.value / totalExibido)),
          transactionIds: row.transactionIds,
        })),
      },
      scope,
      ctx,
      ledger,
    );
    if ("error" in painelPorOperadora) return painelPorOperadora;

    return {
      ...painelDaSerie,
      artifactIds: [...painelDaSerie.artifactIds, ...painelPorOperadora.artifactIds],
      viewKinds: [...painelDaSerie.viewKinds, ...painelPorOperadora.viewKinds],
    };
  },
});
