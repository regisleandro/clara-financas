import { randomUUID } from "node:crypto";

import {
  CategorizationArtifactSchema,
  CategorizationResultSchema,
} from "@clara-financas/views/agent-contracts";
import { ViewSchema } from "@clara-financas/views";
import { defineTool } from "eve/tools";

import { persistArtifact } from "../../../lib/artifacts";
import { requireTenantCaller } from "../../../lib/tenant";

const proposalId = () => `cat_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

export default defineTool({
  description:
    "Persists the complete categorisation proposal and returns an opaque receipt. Call exactly once after triage; return its receipt unchanged and never list transaction ids in the final output.",
  inputSchema: CategorizationResultSchema,
  async execute(input, ctx) {
    requireTenantCaller(ctx);
    const result = CategorizationResultSchema.parse(input);
    const matchedRules = result.matchedRules.map((match) => ({ ...match, proposalId: proposalId() }));
    const proposals = result.proposals.map((proposal) => ({ ...proposal, proposalId: proposalId() }));
    const merchantAliases = result.merchantAliases.map((proposal) => ({
      ...proposal,
      proposalId: proposalId(),
    }));
    const rows = [
      ...matchedRules.map((match) => ({
        label: match.categoryLabel,
        detail: `Regra aprendida · ${match.reason}`,
        transactionIds: match.transactionIds,
      })),
      ...proposals.map((proposal) => ({
        label: proposal.merchant,
        detail:
          proposal.categoryLabel === null
            ? `Categoria a decidir · ${proposal.reason}`
            : `${proposal.categoryLabel} · ${proposal.reason}`,
        transactionIds: proposal.transactionIds,
      })),
      ...merchantAliases.map((proposal) => ({
        label: proposal.aliases.join(" / "),
        detail: `Possível mesmo comerciante · ${proposal.reason}`,
        transactionIds: proposal.transactionIds,
      })),
    ];
    const view = ViewSchema.parse(
      rows.length === 0
        ? {
            kind: "metric",
            title: "Organização de categorias",
            summary: "Nenhuma proposta de categoria foi encontrada.",
            metric: { label: "Resultado", text: "Nada a organizar", transactionIds: [] },
            rows: [],
          }
        : {
            kind: "proposal",
            title: "Propostas de categoria",
            summary: "Revise as categorias sugeridas antes de aplicar qualquer mudança.",
            rows,
          },
    );
    const artifact = CategorizationArtifactSchema.parse({
      artifactKind: "categorization",
      matchedRules,
      proposals,
      merchantAliases,
      warnings: result.warnings,
      view,
    });

    const { artifactId } = await persistArtifact("categorization", artifact, ctx);
    const count = matchedRules.length + proposals.length + merchantAliases.length;
    return {
      artifactId,
      artifactKind: "categorization" as const,
      nextAction: "present_categorization" as const,
      proposalCount: count,
      warnings: result.warnings,
    };
  },
});
