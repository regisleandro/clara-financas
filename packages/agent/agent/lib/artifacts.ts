import { randomUUID } from "node:crypto";

import { getDb } from "@clara-financas/db";
import {
  agentArtifacts,
  type AgentArtifactKind,
} from "@clara-financas/db/schema/agent-artifact";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq, lte } from "drizzle-orm";

import { toolError, type ToolError } from "./errors";
import { requireSessionCaller, type AuthenticatedContext } from "./tenant";

const ARTIFACT_TTL_MS = 24 * 60 * 60 * 1_000;

type ArtifactContext = AuthenticatedContext & {
  session: AuthenticatedContext["session"] & { parent?: { sessionId?: string } };
};

export type StoredArtifact<T> = {
  id: string;
  kind: AgentArtifactKind;
  payload: T;
  expiresAt: Date;
};

/** Persiste um resultado validado e devolve a única referência que cruza agentes. */
export async function persistArtifact<T>(
  kind: AgentArtifactKind,
  payload: T,
  ctx: ArtifactContext,
): Promise<{ artifactId: string; expiresAt: string }> {
  const { tenantId, sessionId } = requireSessionCaller(ctx);
  const parentSessionId = ctx.session.parent?.sessionId ?? sessionId;
  const artifactId = `art_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ARTIFACT_TTL_MS);

  await forTenant(
    tenantId,
    async (tx) => {
      // Limpeza oportunista mantém a staging limitada mesmo sem cron dedicado.
      await tx
        .delete(agentArtifacts)
        .where(and(eq(agentArtifacts.tenantId, tenantId), lte(agentArtifacts.expiresAt, now)));
      await tx.insert(agentArtifacts).values({
        id: artifactId,
        tenantId,
        parentSessionId,
        kind,
        payload,
        expiresAt,
      });
    },
    getDb(),
  );

  return { artifactId, expiresAt: expiresAt.toISOString() };
}

/**
 * Lê somente artefatos criados para esta sessão-pai. O id sozinho nunca é
 * autoridade: tenant e sessão fazem parte da chave de acesso.
 */
export async function readArtifact<T>(
  artifactId: string,
  expectedKind: AgentArtifactKind,
  ctx: ArtifactContext,
): Promise<StoredArtifact<T> | ToolError> {
  const { tenantId, sessionId } = requireSessionCaller(ctx);

  return forTenant(
    tenantId,
    async (tx) => {
      const [row] = await tx
        .select({
          id: agentArtifacts.id,
          kind: agentArtifacts.kind,
          payload: agentArtifacts.payload,
          expiresAt: agentArtifacts.expiresAt,
        })
        .from(agentArtifacts)
        .where(
          and(
            eq(agentArtifacts.id, artifactId),
            eq(agentArtifacts.tenantId, tenantId),
            eq(agentArtifacts.parentSessionId, sessionId),
          ),
        )
        .limit(1);

      if (row === undefined || row.kind !== expectedKind) {
        return toolError(
          "artefato_nao_encontrado",
          "O resultado temporário desta análise não foi encontrado nesta conversa.",
          { hint: "Delegue novamente ao mesmo subagente, preservando o escopo original." },
        );
      }

      if (row.expiresAt.getTime() <= Date.now()) {
        await tx.delete(agentArtifacts).where(eq(agentArtifacts.id, row.id));
        return toolError(
          "artefato_expirado",
          "O resultado temporário expirou antes de ser apresentado.",
          { hint: "Delegue novamente ao mesmo subagente, preservando o escopo original." },
        );
      }

      return row as StoredArtifact<T>;
    },
    getDb(),
  );
}
