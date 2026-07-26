import { z } from "zod";

const cents = z.number().int();
const transactionIds = z.array(z.string().min(1)).min(1);

export const ExtractionResultSchema = z.object({
  documentId: z.string().min(1),
  issuer: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  dueDate: z.string().nullable(),
  declaredTotal: cents.nullable(),
  declaredSubtotals: z
    .object({
      fees: cents.nullable(),
      purchases: cents.nullable(),
    })
    .nullable(),
  transactions: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      originalDescription: z.string().min(1),
      merchant: z.string().nullable(),
      amount: cents,
      kind: z.enum(["purchase", "payment", "refund", "fee", "adjustment"]),
      installment: z
        .object({ current: z.number().int().positive(), total: z.number().int().positive() })
        .nullable(),
      category: z.string().nullable(),
      extractionConfidence: z.enum(["alta", "media", "baixa"]),
      page: z.number().int().positive().nullable(),
    }),
  ),
  warnings: z.array(z.string()).default([]),
});

/**
 * O que o analista devolve.
 *
 * Duas correções que este schema carrega, e as duas nasceram da mesma falha em
 * produção — *"a consulta que eu fiz para localizar a divergência não retornou
 * a estrutura necessária"*:
 *
 * 1. **`checksum` é uma forma legítima de análise.** Ela existe no `ViewSchema`
 *    desde sempre, e as instruções mandam apresentar uma conferência assim —
 *    mas o analista, que é quem produz o número, não podia devolvê-la. A forma
 *    certa era inexprimível pelo único subagente autorizado a calcular.
 *
 * 2. **Proveniência é condicional, não universal.** `transactionIds` era
 *    `.min(1)` em toda linha e `rows` era obrigatório. Consequência: "não
 *    encontrei nada neste recorte" e "a diferença de R$ 0,03 é arredondamento"
 *    — as duas respostas CERTAS quando a conta não fecha — eram inválidas. O
 *    modelo não tinha saída válida, o schema reprovava, e a coordenadora
 *    improvisava um pedido de desculpas.
 *
 * A regra fica a mesma do painel (`ViewSchema`, `./index.ts`): valor derivado
 * de lançamentos exige os ids; fato do documento, não.
 */
const provenance = z.array(z.string().min(1)).default([]);

const AnalysisMetricSchema = z.object({
  label: z.string().min(1),
  amount: cents.optional(),
  text: z.string().optional(),
  detail: z.string().optional(),
  transactionIds: provenance,
});

const AnalysisRowSchema = z.object({
  label: z.string().min(1),
  amount: cents.optional(),
  detail: z.string().optional(),
  share: z.number().min(0).max(1).optional(),
  trend: z.enum(["up", "down", "flat"]).optional(),
  transactionIds: provenance,
});

export const AnalysisResultSchema = z
  .object({
    kind: z.enum(["metric", "breakdown", "comparison", "recurrences", "transactions", "checksum"]),
    title: z.string().min(1),
    summary: z.string().min(1),
    metric: AnalysisMetricSchema.optional(),
    previousLabel: z.string().optional(),
    currentLabel: z.string().optional(),
    // Vazio é resposta: um recorte sem lançamentos devolve `rows: []` e diz
    // isso no `summary`, em vez de falhar a validação.
    rows: z.array(AnalysisRowSchema).default([]),
    /** A conferência de uma fatura, nos mesmos campos do painel `checksum`. */
    checksum: z
      .object({
        batchId: z.string().min(1),
        declaredTotal: cents.nullable(),
        extractedTotal: cents,
        difference: cents.nullable(),
        result: z.enum(["match", "mismatch", "no_declared_total"]),
        cause: z.string().optional(),
      })
      .optional(),
    warnings: z.array(z.string()).default([]),
    ledgerCoverage: z
      .object({
        count: z.number().int().nonnegative(),
        firstDate: z.string().nullable(),
        lastDate: z.string().nullable(),
      })
      .optional(),
  })
  .superRefine((result, ctx) => {
    if (result.kind === "checksum") {
      if (result.checksum === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "uma análise de conferência exige o objeto checksum",
          path: ["checksum"],
        });
      }
      // Linhas de conferência descrevem o documento, não lançamentos.
      return;
    }

    if (result.metric?.amount !== undefined && result.metric.transactionIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "uma métrica com valor exige transactionIds",
        path: ["metric", "transactionIds"],
      });
    }

    for (const [index, row] of result.rows.entries()) {
      const financial =
        row.amount !== undefined ||
        row.share !== undefined ||
        row.trend !== undefined ||
        result.kind === "recurrences" ||
        result.kind === "transactions";
      if (financial && row.transactionIds.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "uma linha financeira exige transactionIds",
          path: ["rows", index, "transactionIds"],
        });
      }
    }
  });

export const CategorizationResultSchema = z.object({
  matchedRules: z.array(
    z.object({
      conceptId: z.string().min(1),
      categoryId: z.string().min(1),
      categoryLabel: z.string().min(1),
      reason: z.string().min(1),
      transactionIds,
    }),
  ),
  proposals: z.array(
    z.object({
      merchant: z.string().min(1),
      categoryId: z.string().nullable(),
      categoryLabel: z.string().nullable(),
      reason: z.string().min(1),
      transactionIds,
    }),
  ),
  merchantAliases: z.array(
    z.object({
      aliases: z.array(z.string().min(1)).min(2),
      reason: z.string().min(1),
      transactionIds,
    }),
  ),
  warnings: z.array(z.string()).default([]),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type CategorizationResult = z.infer<typeof CategorizationResultSchema>;
