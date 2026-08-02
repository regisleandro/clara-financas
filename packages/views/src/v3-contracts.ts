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

export const EntityReferenceSchema = z.object({
  type: z.enum(["document", "invoice", "statement", "merchant", "category", "transaction"]),
  id: z.string().min(1),
  label: z.string().min(1),
});

export const GoalStatusSchema = z.enum([
  "active",
  "waiting",
  "completed",
  "needs_input",
  "blocked",
  "cancelled",
]);

export const TaskStatusSchema = z.enum([
  "queued",
  "running",
  "complete",
  "needs_input",
  "blocked",
  "failed",
  "cancelled",
]);

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

export const GoalSpecSchema = z.object({
  goalId: z.string().min(1),
  intent: z.string().min(1),
  entities: z.array(EntityReferenceSchema).default([]),
  scope: FinancialScopeV3Schema.optional(),
  completionCriteria: z.array(z.string().min(1)).min(1),
  status: GoalStatusSchema,
});

export const SpecialistTaskSchema = z.object({
  taskId: z.string().min(1),
  goalId: z.string().min(1),
  specialist: z.enum(["documents", "reconciliation", "categorization", "analysis"]),
  objective: z.string().min(1),
  contextRefs: z.array(z.string().min(1)).default([]),
  completionCriteria: z.array(z.string().min(1)).min(1),
  status: TaskStatusSchema,
});

export const TaskResultSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(["complete", "needs_input", "blocked"]),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  artifactRefs: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string()).default([]),
  missingInputs: z.array(z.string()).default([]),
});

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

export const DecisionProposalSchema = z.object({
  decisionId: z.string().min(1),
  operation: z.string().min(1),
  title: z.string().min(1),
  consequence: z.string().min(1),
  targetRef: z.string().min(1),
  entityRevision: z.string().datetime(),
  status: z.enum(["pending", "approved", "denied", "expired", "applied", "failed"]),
  expiresAt: z.string().datetime(),
});

export const ExplicitDecisionAuthorizationSchema = z.object({
  decisionId: z.string().min(1),
  action: z.enum(["approve", "deny"]),
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export type EntityReference = z.infer<typeof EntityReferenceSchema>;
export type GoalSpec = z.infer<typeof GoalSpecSchema>;
export type SpecialistTask = z.infer<typeof SpecialistTaskSchema>;
export type TaskResult = z.infer<typeof TaskResultSchema>;
export type FinancialScopeV3 = z.infer<typeof FinancialScopeV3Schema>;
export type FinancialArtifact = z.infer<typeof FinancialArtifactSchema>;
export type FinancialArtifactBlock = z.infer<typeof FinancialArtifactBlockSchema>;
export type DecisionProposal = z.infer<typeof DecisionProposalSchema>;
export type ExplicitDecisionAuthorization = z.infer<
  typeof ExplicitDecisionAuthorizationSchema
>;
