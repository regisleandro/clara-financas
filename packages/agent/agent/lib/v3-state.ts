import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { agentTasks } from "@clara-financas/db/schema/agent-task";
import { conversationArtifacts } from "@clara-financas/db/schema/conversation-artifact";
import { conversationGoals } from "@clara-financas/db/schema/conversation-goal";
import { decisionProposals } from "@clara-financas/db/schema/decision-proposal";
import { forTenant } from "@clara-financas/db/tenant-scope";
import type { FinancialArtifact, GoalSpec, SpecialistTask, TaskResult } from "@clara-financas/views";
import { and, eq } from "drizzle-orm";

import { requireSessionCaller, requireTenantCaller, type AuthenticatedContext } from "./tenant";

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;

function sessionIdOf(ctx: AuthenticatedContext): string {
  return ctx.session.parent?.sessionId ?? requireSessionCaller(ctx).sessionId;
}

/** Persiste a intenção da Clara antes da primeira delegação. */
export async function createGoal(
  input: Omit<GoalSpec, "goalId" | "status"> & { status?: GoalSpec["status"] },
  ctx: AuthenticatedContext,
): Promise<GoalSpec> {
  const { tenantId } = requireSessionCaller(ctx);
  const goalId = id("goal");
  const sessionId = sessionIdOf(ctx);
  const status = input.status ?? "active";

  await forTenant(
    tenantId,
    async (tx) => {
      await tx.insert(conversationGoals).values({
        id: goalId,
        tenantId,
        sessionId,
        intent: input.intent,
        entities: input.entities,
        scope: input.scope ?? null,
        completionCriteria: input.completionCriteria,
        status,
      });
    },
    getDb(),
  );

  return { ...input, goalId, status };
}

/** Abre uma tarefa explícita para que a delegação seja observável e retomável. */
export async function createTask(
  input: Omit<SpecialistTask, "taskId" | "status"> & { status?: SpecialistTask["status"] },
  ctx: AuthenticatedContext,
): Promise<SpecialistTask> {
  const { tenantId } = requireSessionCaller(ctx);
  const taskId = id("task");
  const sessionId = sessionIdOf(ctx);
  const status = input.status ?? "queued";

  await forTenant(
    tenantId,
    async (tx) => {
      await tx.insert(agentTasks).values({
        id: taskId,
        tenantId,
        sessionId,
        goalId: input.goalId,
        specialist: input.specialist,
        objective: input.objective,
        contextRefs: input.contextRefs,
        completionCriteria: input.completionCriteria,
        status,
      });
    },
    getDb(),
  );

  return { ...input, taskId, status };
}

export async function settleTask(result: TaskResult, ctx: AuthenticatedContext): Promise<TaskResult> {
  const { tenantId } = requireSessionCaller(ctx);
  await forTenant(
    tenantId,
    async (tx) => {
      await tx
        .update(agentTasks)
        .set({
          status: result.status,
          resultRefs: [...result.evidenceRefs, ...result.artifactRefs],
          warnings: result.warnings,
          missingInputs: result.missingInputs,
          completedAt:
            result.status === "complete" ||
            result.status === "needs_input" ||
            result.status === "blocked" ||
            result.status === "failed" ||
            result.status === "cancelled"
              ? new Date()
              : null,
        })
        .where(and(eq(agentTasks.id, result.taskId), eq(agentTasks.tenantId, tenantId)));
    },
    getDb(),
  );
  return result;
}

export async function updateGoalStatus(
  goalId: string,
  status: GoalSpec["status"],
  ctx: AuthenticatedContext,
): Promise<void> {
  const { tenantId } = requireSessionCaller(ctx);
  await forTenant(
    tenantId,
    async (tx) => {
      await tx
        .update(conversationGoals)
        .set({ status, updatedAt: new Date(), completedAt: status === "completed" ? new Date() : null })
        .where(and(eq(conversationGoals.id, goalId), eq(conversationGoals.tenantId, tenantId)));
    },
    getDb(),
  );
}

/** Publica um artefato validado e durável para a conversa. */
export async function publishArtifact(
  artifact: Omit<FinancialArtifact, "artifactId" | "createdAt" | "version"> & {
    version?: number;
  },
  ctx: AuthenticatedContext,
): Promise<FinancialArtifact> {
  const { tenantId } = requireSessionCaller(ctx);
  const artifactId = id("art");
  const sessionId = sessionIdOf(ctx);
  const version = artifact.version ?? 1;
  const createdAt = new Date().toISOString();
  const result = { ...artifact, artifactId, version, createdAt } as FinancialArtifact;

  await forTenant(
    tenantId,
    async (tx) => {
      await tx.insert(conversationArtifacts).values({
        id: artifactId,
        tenantId,
        sessionId,
        goalId: artifact.goalId ?? null,
        kind: artifact.kind,
        version,
        payload: result,
      });
    },
    getDb(),
  );
  return result;
}

/** Lê um artefato visível apenas para a conversa-pai que o publicou. */
export async function readPublishedArtifact(
  artifactId: string,
  ctx: AuthenticatedContext,
): Promise<{ id: string; kind: string; payload: unknown } | null> {
  const { tenantId } = requireTenantCaller(ctx);
  const sessionId = sessionIdOf(ctx);
  return forTenant(
    tenantId,
    async (tx) => {
      const [row] = await tx
        .select({
          id: conversationArtifacts.id,
          kind: conversationArtifacts.kind,
          payload: conversationArtifacts.payload,
        })
        .from(conversationArtifacts)
        .where(
          and(
            eq(conversationArtifacts.id, artifactId),
            eq(conversationArtifacts.tenantId, tenantId),
            eq(conversationArtifacts.sessionId, sessionId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    getDb(),
  );
}

export type DecisionInput = {
  operation: string;
  targetRef: string;
  title: string;
  consequence: string;
  payload: Record<string, unknown>;
  entityRevision: Date;
  goalId?: string;
  taskId?: string;
  expiresAt?: Date;
};

export async function createDecision(
  input: DecisionInput,
  ctx: AuthenticatedContext,
): Promise<{ decisionId: string; expiresAt: string }> {
  const { tenantId, userId } = requireSessionCaller(ctx);
  const decisionId = id("decision");
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 30 * 60_000);
  await forTenant(
    tenantId,
    async (tx) => {
      await tx.insert(decisionProposals).values({
        id: decisionId,
        tenantId,
        sessionId: sessionIdOf(ctx),
        goalId: input.goalId ?? null,
        taskId: input.taskId ?? null,
        operation: input.operation,
        targetRef: input.targetRef,
        title: input.title,
        consequence: input.consequence,
        payload: input.payload,
        entityRevision: input.entityRevision,
        preparedBy: `user:${userId}`,
        expiresAt,
      });
    },
    getDb(),
  );
  return { decisionId, expiresAt: expiresAt.toISOString() };
}
