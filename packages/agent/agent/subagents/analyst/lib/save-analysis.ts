import {
  AnalysisArtifactSchema,
  type AnalysisRequestScope,
} from "@clara-financas/views/agent-contracts";
import { ViewSchema, type View } from "@clara-financas/views";

import { canonicalAnalysisRequestScope } from "../../../lib/analysis-scope";
import { persistArtifact } from "../../../lib/artifacts";
import { behaviorV2Enabled, behaviorV2PersistsShadow } from "../../../lib/behavior-v2";
import { requireTenantCaller } from "../../../lib/tenant";

type ArtifactContext = Parameters<typeof persistArtifact>[2];

export async function saveAnalysis(
  viewInput: View,
  requestedScope: AnalysisRequestScope,
  ctx: ArtifactContext,
  warnings: string[] = [],
) {
  const { tenantId } = requireTenantCaller(ctx);
  const view = ViewSchema.parse(viewInput);
  const canonicalScope = canonicalAnalysisRequestScope(requestedScope);
  const artifact = AnalysisArtifactSchema.parse({
    artifactKind: "analysis",
    requestedScope: canonicalScope,
    actualScope: canonicalScope,
    view,
    warnings,
  });

  // O mesmo binário suporta rollback imediato: em off o contrato legado é
  // preservado; shadow/canary ainda gravam o artefato para comparação offline.
  if (!behaviorV2PersistsShadow()) return view;

  const { artifactId } = await persistArtifact("analysis", artifact, ctx);
  if (!behaviorV2Enabled(tenantId)) return view;

  return {
    artifactId,
    artifactKind: "analysis" as const,
    nextAction: "present_analysis" as const,
    viewKind: view.kind,
    warnings,
  };
}
