import { z } from "zod";

import { AnalysisScopeSchema, ComparableAnalysisScopeSchema } from "./analysis-scope-contracts";

/**
 * Contratos da Clara v3.
 *
 * Eles descrevem o trabalho que a Clara está coordenando, não o raciocínio
 * privado do modelo. Todos os ids são referências opacas; valores financeiros
 * continuam em centavos inteiros e carregam a sua proveniência.
 */

const cents = z.number().int();

export const FinancialScopeV3Schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("invoices"),
    batchIds: z.array(z.string().min(1)).min(1).max(12),
    issuer: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("periods"),
    periods: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          scope: z.union([AnalysisScopeSchema, ComparableAnalysisScopeSchema]),
        }),
      )
      .min(2)
      .max(12),
  }),
  z.object({
    kind: z.literal("document"),
    documentId: z.string().min(1),
    documentKind: z.enum(["credit_card_invoice", "bank_statement", "invoice_nfe"]),
  }),
]);


const ProvenanceSchema = z.object({
  transactionIds: z.array(z.string().min(1)).default([]),
  documentIds: z.array(z.string().min(1)).default([]),
});

const MetricBlockSchema = z.object({
  type: z.literal("metric"),
  label: z.string().min(1),
  amount: cents.optional(),
  text: z.string().optional(),
  detail: z.string().optional(),
  provenance: ProvenanceSchema,
});

const SeriesPointSchema = z.object({
  periodId: z.string().min(1),
  label: z.string().min(1),
  amount: cents,
  provenance: ProvenanceSchema,
});

const SeriesBlockSchema = z.object({
  type: z.literal("series"),
  title: z.string().min(1),
  points: z.array(SeriesPointSchema).min(2).max(12),
});

const BreakdownBlockSchema = z.object({
  type: z.literal("breakdown"),
  title: z.string().min(1),
  rows: z
    .array(
      z.object({
        label: z.string().min(1),
        amount: cents,
        share: z.number().min(0).max(1).optional(),
        detail: z.string().optional(),
        provenance: ProvenanceSchema,
      }),
    )
    .min(1)
    .max(50),
});

const TableBlockSchema = z.object({
  type: z.literal("table"),
  title: z.string().min(1),
  columns: z.array(z.string().min(1)).min(1).max(8),
  rows: z
    .array(
      z.object({
        cells: z.array(z.string()).min(1).max(8),
        provenance: ProvenanceSchema,
      }),
    )
    .max(100),
});

const ReconciliationBlockSchema = z.object({
  type: z.literal("reconciliation"),
  documentId: z.string().min(1),
  documentKind: z.enum(["credit_card_invoice", "bank_statement", "invoice_nfe"]),
  result: z.enum(["match", "mismatch", "no_declared_total", "insufficient_data"]),
  declaredAmount: cents.nullable(),
  calculatedAmount: cents.nullable(),
  difference: cents.nullable(),
  explanation: z.string().min(1),
});

export const FinancialArtifactBlockSchema = z.discriminatedUnion("type", [
  MetricBlockSchema,
  SeriesBlockSchema,
  BreakdownBlockSchema,
  TableBlockSchema,
  ReconciliationBlockSchema,
]);

export const FinancialArtifactSchema = z.object({
  artifactId: z.string().min(1),
  version: z.number().int().positive(),
  kind: z.enum(["analysis", "comparison", "breakdown", "reconciliation", "timeline", "proposal"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  goalId: z.string().min(1).optional(),
  scope: FinancialScopeV3Schema.optional(),
  blocks: z.array(FinancialArtifactBlockSchema).min(1).max(12),
  warnings: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});

export type FinancialScopeV3 = z.infer<typeof FinancialScopeV3Schema>;
export type FinancialArtifact = z.infer<typeof FinancialArtifactSchema>;
export type FinancialArtifactBlock = z.infer<typeof FinancialArtifactBlockSchema>;
