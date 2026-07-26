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

export const AnalysisResultSchema = z.object({
  kind: z.enum(["metric", "breakdown", "comparison", "recurrences", "transactions"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  metric: z
    .object({
      label: z.string().min(1),
      amount: cents.optional(),
      text: z.string().optional(),
      detail: z.string().optional(),
      transactionIds,
    })
    .optional(),
  previousLabel: z.string().optional(),
  currentLabel: z.string().optional(),
  rows: z.array(
    z.object({
      label: z.string().min(1),
      amount: cents.optional(),
      detail: z.string().optional(),
      share: z.number().min(0).max(1).optional(),
      trend: z.enum(["up", "down", "flat"]).optional(),
      transactionIds,
    }),
  ),
  warnings: z.array(z.string()).default([]),
  ledgerCoverage: z
    .object({
      count: z.number().int().nonnegative(),
      firstDate: z.string().nullable(),
      lastDate: z.string().nullable(),
    })
    .optional(),
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
