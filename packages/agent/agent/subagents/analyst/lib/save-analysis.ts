import {
  AnalysisArtifactSchema,
  type AnalysisRequestScope,
} from "@clara-financas/views/agent-contracts";
import { ViewSchema, type View, type ViewInput } from "@clara-financas/views";
import { sumOf, witnessOf, type Countable } from "@clara-financas/ledger";

import { canonicalAnalysisRequestScope } from "../../../lib/analysis-scope";
import { persistArtifact } from "../../../lib/artifacts";
import { refused } from "../../../lib/errors";
import { requireTenantCaller } from "../../../lib/tenant";

type ArtifactContext = Parameters<typeof persistArtifact>[2];

/**
 * O ponto de estrangulamento por onde TODO painel analítico passa.
 *
 * O parâmetro `witness` é obrigatório de propósito: são os lançamentos que a
 * tool realmente leu do razão para montar aquele painel. Confrontar o painel
 * contra eles é a única checagem que um schema não tem como fazer — Zod valida
 * forma, não tem acesso ao banco, e por isso `ViewSchema` conseguia garantir
 * que os `transactionIds` EXISTEM sem nunca garantir que eles EXPLICAM o
 * número ao lado.
 *
 * Torná-lo obrigatório também é o mecanismo que fez esta correção acontecer:
 * mudar a assinatura quebra o build em cada tool que publica painel, então o
 * compilador força a visita a todas elas. É o oposto de uma regra escrita no
 * prompt, que depende de alguém lembrar.
 */
export async function saveAnalysis(
  viewInput: ViewInput,
  requestedScope: AnalysisRequestScope,
  ctx: ArtifactContext,
  /** Os lançamentos lidos para montar este painel. */
  witness: readonly Countable[],
  warnings: string[] = [],
) {
  // Falha fechada se não houver inquilino autenticado: `persistArtifact`
  // depende disso, e é melhor recusar aqui que gravar sem dono.
  requireTenantCaller(ctx);
  const view = ViewSchema.parse(viewInput);

  const divergences = auditView(view, witness);
  if (divergences.length > 0) {
    // Falha fechada. Um painel que não reconcilia é exatamente o defeito que a
    // pessoa relata como "os cálculos não fecham" — devolvê-lo com um aviso
    // discreto seria publicar o erro com uma nota de rodapé.
    return refused(
      "painel_nao_reconcilia",
      `O painel não fecha com o razão: ${divergences.join("; ")}.`,
      {
        hint: "Monte o valor e a proveniência a partir do MESMO conjunto de lançamentos (ver sumOf/deltaOf em @clara-financas/ledger). Não recalcule o valor por fora.",
      },
    );
  }

  const canonicalScope = canonicalAnalysisRequestScope(requestedScope);
  const artifact = AnalysisArtifactSchema.parse({
    artifactKind: "analysis",
    requestedScope: canonicalScope,
    actualScope: canonicalScope,
    view,
    warnings,
  });

  const { artifactId } = await persistArtifact("analysis", artifact, ctx);

  // Uma chamada produz um painel; o analista junta os recibos de várias
  // chamadas numa entrega só quando a pergunta pede mais de um. A lista existe
  // para que ele TENHA como fazer isso — antes, a instrução mandava e o
  // contrato não permitia.
  return {
    artifactIds: [artifactId],
    artifactKind: "analysis" as const,
    nextAction: "present_analysis" as const,
    viewKinds: [view.kind],
    warnings,
  };
}

/**
 * Confere o painel contra a testemunha, e devolve as divergências em português.
 *
 * Duas checagens, e as duas nasceram de defeito real:
 *
 *  1. **Cada valor reconstrói pelos próprios ids.** Pega o caso em que valor e
 *     proveniência foram montados por caminhos independentes.
 *  2. **As linhas somam o número em destaque.** Pega o caso em que os dois
 *     estão certos isoladamente mas medem escalas diferentes — bruto nas
 *     linhas, líquido no topo.
 *
 * A segunda só vale para painéis ADITIVOS. Numa comparação as linhas são
 * variações por categoria e o topo é a variação total: também somam, mas isso
 * depende de os dois lados terem sido montados como diferença, e quem verifica
 * essa forma é `reconcile`.
 */
function auditView(view: View, witness: readonly Countable[]): string[] {
  const amounts = witnessOf(witness);
  const problems: string[] = [];

  const metric = "metric" in view ? view.metric : undefined;
  const rows = "rows" in view ? view.rows : [];

  /*
   * Cada número DECLARA como foi construído (`basis`), e a equação verificada
   * é a daquela forma. Checar tudo como soma seria trocar um defeito por
   * outro: numa comparação o valor é uma diferença e os ids são a união dos
   * dois lados, então exigir que os ids somem o valor reprovaria o painel
   * CERTO.
   *
   *  - sum        → o valor reconstrói pelos próprios ids
   *  - delta      → os ids são a união dos lados; verifica-se que as variações
   *                 por linha somam a variação total
   *  - projection → estimativa (custo anualizado); só a proveniência é
   *                 verificável aqui
   *  - document   → sem lançamento por trás, por natureza
   *  - count      → não é dinheiro
   *
   * Antes a forma era inferida do `kind` da view, o que é grosso demais: uma
   * diferença dentro de uma composição passava batida, porque o painel inteiro
   * era tratado como soma.
   *
   * O que AINDA não é verificável: a álgebra interna de delta e projeção — se
   * a diferença bate com os dois lados, se o fator é o declarado. Isso exige
   * que as figuras aninhadas viajem no painel, e não só a etiqueta. As equações
   * existem e são testadas em `@clara-financas/ledger/figure`; o que falta é o
   * contrato carregá-las. Esta função é honesta sobre o que cobre.
   */
  if (view.kind === "checksum") return problems;

  // Proveniência REAL: todo id citado precisa existir no recorte que a própria
  // tool leu. Vale para qualquer forma — é o que pega o painel montado com um
  // recorte e os ids de outro.
  const unknown = [metric, ...rows]
    .filter((cell): cell is NonNullable<typeof cell> => cell !== undefined)
    .flatMap((cell) => cell.transactionIds)
    .filter((id) => !amounts.has(id));
  if (unknown.length > 0) {
    problems.push(
      `${unknown.length} lançamento(s) citado(s) não estão no recorte lido para montar o painel`,
    );
    // Sem proveniência confiável, as somas abaixo mediriam ruído.
    return problems;
  }

  // Só quem se declara SOMA precisa reconstruir somando.
  const reconstroi = (
    cell: { amount?: number; basis: string; transactionIds: string[] },
    subject: string,
  ) => {
    if (cell.basis !== "sum") return;
    if (cell.amount === undefined || cell.transactionIds.length === 0) return;
    const rebuilt = sumOf(cell.transactionIds.map((id) => ({ id, amount: amounts.get(id)! })));
    if (rebuilt.value !== cell.amount) {
      problems.push(`${subject} diz ${cell.amount} mas seus lançamentos somam ${rebuilt.value}`);
    }
  };

  if (metric !== undefined) reconstroi(metric, "o número em destaque");
  for (const row of rows) reconstroi(row, `a linha "${row.label}"`);

  /*
   * As partes somam o todo — em painéis que são uma PARTIÇÃO.
   *
   * Vale para composição (`breakdown`: cada linha é uma fatia do total) e para
   * comparação (as variações por categoria somam a variação total). É a
   * checagem que a pessoa fazia de cabeça e que reprovava o painel: somar a
   * coluna dava outro número que o destaque.
   *
   * NÃO vale para `transactions`, e isso não é uma omissão: ali as linhas são
   * lançamentos individuais — a lista pode vir truncada, e o destaque conta só
   * gasto enquanto a lista mostra também pagamentos. Exigir a soma reprovaria o
   * painel certo, que é o erro simétrico ao que estamos consertando.
   */
  const additive = view.kind === "breakdown" || view.kind === "comparison";
  if (
    additive &&
    metric?.amount !== undefined &&
    rows.length > 0 &&
    rows.every((row) => row.amount !== undefined)
  ) {
    const rowsTotal = rows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
    if (rowsTotal !== metric.amount) {
      problems.push(
        `as linhas somam ${rowsTotal} mas o destaque diz ${metric.amount} — as duas precisam estar na mesma escala`,
      );
    }
  }

  return problems;
}
