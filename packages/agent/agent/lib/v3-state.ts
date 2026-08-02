import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import { conversationArtifacts } from "@clara-financas/db/schema/conversation-artifact";
import { forTenant } from "@clara-financas/db/tenant-scope";
import type { FinancialArtifact } from "@clara-financas/views";
import { and, eq } from "drizzle-orm";

import { requireSessionCaller, requireTenantCaller, type AuthenticatedContext } from "./tenant";

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;

function sessionIdOf(ctx: AuthenticatedContext): string {
  return ctx.session.parent?.sessionId ?? requireSessionCaller(ctx).sessionId;
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

