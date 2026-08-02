import { CategorizationArtifactSchema } from "@clara-financas/views/agent-contracts";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { readArtifact } from "../lib/artifacts";
import { toolError } from "../lib/errors";

export default defineTool({
  description:
    "Presents categorisation proposals from their opaque artifactId. Call immediately after the bookkeeper returns a receipt; never reconstruct its transaction ids.",
  inputSchema: z.object({ artifactId: z.string().regex(/^art_[a-z0-9]+$/) }),
  async execute(input, ctx) {
    const stored = await readArtifact<unknown>(input.artifactId, "categorization", ctx);
    if ("error" in stored) return stored;
    const parsed = CategorizationArtifactSchema.safeParse(stored.payload);
    if (!parsed.success) {
      return toolError(
        "artefato_invalido",
        "A proposta de categorias não passou pela validação de apresentação.",
        { hint: "Delegue novamente ao categorizador; não reconstrua a proposta." },
      );
    }
    return {
      artifactId: stored.id,
      view: parsed.data.view,
      presented: parsed.data.view.kind,
      proposalIds: [
        ...parsed.data.matchedRules.map((proposal) => proposal.proposalId),
        ...parsed.data.proposals.map((proposal) => proposal.proposalId),
        ...parsed.data.merchantAliases.map((proposal) => proposal.proposalId),
      ],
      actionableCategoryProposalIds: [
        ...parsed.data.matchedRules.map((proposal) => proposal.proposalId),
        ...parsed.data.proposals
          .filter((proposal) => proposal.categoryId !== null)
          .map((proposal) => proposal.proposalId),
      ],
      note:
        "Propostas mostradas. Para aplicar categorias, chame recategorize_transactions com artifactId e os proposalIds escolhidos; a tool abrirá o cartão.",
    };
  },
});
