import { z } from "zod";

import { ViewSchema } from "./index";
import { AnalysisRequestScopeSchema } from "./analysis-scope-contracts";

export {
  AnalysisRequestScopeSchema,
  AnalysisScopeSchema,
  ComparableAnalysisScopeSchema,
} from "./analysis-scope-contracts";
export type {
  AnalysisRequestScope,
  AnalysisScope,
  ComparableAnalysisScope,
} from "./analysis-scope-contracts";

const cents = z.number().int();
const transactionIds = z.array(z.string().min(1)).min(1);

export const AnalysisArtifactSchema = z
  .object({
    artifactKind: z.literal("analysis"),
    requestedScope: AnalysisRequestScopeSchema,
    actualScope: AnalysisRequestScopeSchema,
    view: ViewSchema,
    warnings: z.array(z.string()).default([]),
  })
  .superRefine((artifact, ctx) => {
    if (JSON.stringify(artifact.requestedScope) !== JSON.stringify(artifact.actualScope)) {
      ctx.addIssue({
        code: "custom",
        path: ["actualScope"],
        message: "o escopo efetivo deve ser exatamente o escopo solicitado",
      });
    }
  });

/**
 * O recibo do analista — no PLURAL, porque uma resposta pode ter vários painéis.
 *
 * Este schema dizia `artifactId`, singular, enquanto as instruções mandavam o
 * coordenador usar "a lista completa de `artifactIds` quando o especialista
 * devolveu vários painéis" e o analista, "devolva uma entrega que referencie
 * todos eles". `artifactIds` não existia em lugar nenhum do código.
 *
 * O efeito não era um aviso: o modelo obedecia à instrução, o `outputSchema`
 * reprovava a forma, e o turno morria SEM NENHUMA TOOL TER FALHADO — o cenário
 * que a própria telemetria documenta como o mais difícil de diagnosticar, e o
 * candidato mais forte para "a conversa trava".
 *
 * O plural era a intenção original, e dá para provar: `ActiveArtifact` no
 * frontend é `{ kind: "view"; views: View[] }` desde antes disto, com um
 * comentário explicando que a Clara pode desenhar mais de um painel na mesma
 * resposta. A tela esperava vários; só o contrato do agente não sabia.
 */
export const AnalysisReceiptSchema = z.object({
  artifactIds: z.array(z.string().regex(/^art_[a-z0-9]+$/)).min(1).max(4),
  artifactKind: z.literal("analysis"),
  nextAction: z.literal("present_analysis"),
  /** Uma forma por artefato, na mesma ordem de `artifactIds`. */
  viewKinds: z
    .array(
      z.enum([
        "metric",
        "breakdown",
        "comparison",
        "series",
        "recurrences",
        "transactions",
        "commitments",
        "proposal",
        "checksum",
      ]),
    )
    .min(1),
  warnings: z.array(z.string()).default([]),
});


/**
 * A entrega do analista — UMA forma.
 *
 * Eram três: o recibo, um recibo v3 para a família paralela de artefatos, e a
 * `View` crua do fallback de rollout. O fallback saiu com a flag; a família v3
 * saiu quando a série passou a caber no vocabulário de painéis. Cada forma a
 * menos é uma bifurcação a menos para o modelo errar — e eram justamente essas
 * bifurcações que o prompt gastava parágrafos ensinando a distinguir.
 */
export const AnalysisDeliverySchema = AnalysisReceiptSchema;

/**
 * O que o extrator DEVOLVE ao coordenador: um recibo, não a fatura inteira.
 *
 * A extração completa (`ExtractionResultSchema`, abaixo) não atravessa mais o
 * contexto do pai: o extrator a persiste via `save_extraction` e devolve este
 * recibo com o `extractionId`. O coordenador propõe o lote com
 * `propose_batch_from_extraction` — por referência, sem retranscrever as 100+
 * linhas token a token. Os metadados do documento viajam no recibo porque são
 * o que a conversa precisa citar antes de propor (emissor, ciclo, total).
 */
export const ExtractionReceiptSchema = z.object({
  extractionId: z.string().min(1),
  documentId: z.string().min(1),
  documentKind: z.enum(["credit_card_invoice", "bank_statement", "invoice_nfe"]).default("credit_card_invoice"),
  openingBalance: cents.nullable().default(null),
  closingBalance: cents.nullable().default(null),
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
  transactionCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()).default([]),
});

/**
 * A extração completa — hoje o contrato do input de `save_extraction` e do
 * payload da staging (`extraction_stagings`), não mais a saída do subagente.
 */
export const ExtractionResultSchema = z.object({
  documentId: z.string().min(1),
  documentKind: z.enum(["credit_card_invoice", "bank_statement", "invoice_nfe"]).default("credit_card_invoice"),
  openingBalance: cents.nullable().default(null),
  closingBalance: cents.nullable().default(null),
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
      kind: z.enum([
        "purchase",
        "payment",
        "refund",
        "fee",
        "adjustment",
        "income",
        "transfer",
        "card_payment",
        "cash_withdrawal",
      ]),
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

export const CategorizationArtifactSchema = z.object({
  artifactKind: z.literal("categorization"),
  matchedRules: z.array(
    CategorizationResultSchema.shape.matchedRules.element.extend({ proposalId: z.string().min(1) }),
  ),
  proposals: z.array(
    CategorizationResultSchema.shape.proposals.element.extend({ proposalId: z.string().min(1) }),
  ),
  merchantAliases: z.array(
    CategorizationResultSchema.shape.merchantAliases.element.extend({ proposalId: z.string().min(1) }),
  ),
  warnings: z.array(z.string()).default([]),
  view: ViewSchema,
});

export const CategorizationReceiptSchema = z.object({
  artifactId: z.string().regex(/^art_[a-z0-9]+$/),
  artifactKind: z.literal("categorization"),
  nextAction: z.literal("present_categorization"),
  proposalCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()).default([]),
});


export const CategorizationDeliverySchema = CategorizationReceiptSchema;

export type ExtractionReceipt = z.infer<typeof ExtractionReceiptSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
export type CategorizationResult = z.infer<typeof CategorizationResultSchema>;
export type AnalysisArtifact = z.infer<typeof AnalysisArtifactSchema>;
export type AnalysisReceipt = z.infer<typeof AnalysisReceiptSchema>;
export type AnalysisDelivery = z.infer<typeof AnalysisDeliverySchema>;
export type CategorizationArtifact = z.infer<typeof CategorizationArtifactSchema>;
export type CategorizationReceipt = z.infer<typeof CategorizationReceiptSchema>;
export type CategorizationDelivery = z.infer<typeof CategorizationDeliverySchema>;
