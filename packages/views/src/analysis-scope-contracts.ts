import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "data inválida");

const calendarMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mês deve ser YYYY-MM");

const issuer = z.string().min(1).optional();

/** Escopos aceitos por qualquer leitura determinística do razão. */
export const AnalysisScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("calendar_month"), month: calendarMonth, issuer }),
  z.object({ kind: z.literal("invoice"), batchId: z.string().min(1) }),
  z
    .object({ kind: z.literal("range"), from: isoDate, to: isoDate, issuer })
    .refine((scope) => scope.from <= scope.to, {
      message: "from deve ser anterior ou igual a to",
      path: ["to"],
    }),
  z.object({ kind: z.literal("all"), issuer }),
]);

/** Escopos que podem ser comparados sem uma semântica aberta. */
export const ComparableAnalysisScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("calendar_month"), month: calendarMonth, issuer }),
  z.object({ kind: z.literal("invoice"), batchId: z.string().min(1) }),
  z
    .object({ kind: z.literal("range"), from: isoDate, to: isoDate, issuer })
    .refine((scope) => scope.from <= scope.to, {
      message: "from deve ser anterior ou igual a to",
      path: ["to"],
    }),
]);

export const AnalysisRequestScopeSchema = z.union([
  AnalysisScopeSchema,
  z.object({
    kind: z.literal("comparison"),
    current: ComparableAnalysisScopeSchema,
    previous: ComparableAnalysisScopeSchema,
  }),
]);

export type AnalysisScope = z.infer<typeof AnalysisScopeSchema>;
export type ComparableAnalysisScope = z.infer<typeof ComparableAnalysisScopeSchema>;
export type AnalysisRequestScope = z.infer<typeof AnalysisRequestScopeSchema>;
