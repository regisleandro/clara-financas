import { AnalysisArtifactSchema } from "@clara-financas/views/agent-contracts";
import { viewTransactionIds } from "@clara-financas/views";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { readArtifact } from "../lib/artifacts";
import { toolError } from "../lib/errors";

export default defineTool({
  description:
    "Presents an analysis by its opaque artifactId. Use immediately after the analyst returns a receipt. Never rebuild or copy its numbers into present_view.",
  inputSchema: z.object({ artifactId: z.string().regex(/^art_[a-z0-9]+$/) }),
  async execute(input, ctx) {
    const stored = await readArtifact<unknown>(input.artifactId, "analysis", ctx);
    if ("error" in stored) return stored;

    const parsed = AnalysisArtifactSchema.safeParse(stored.payload);
    if (!parsed.success) {
      return toolError(
        "artefato_invalido",
        "A análise foi produzida, mas não passou pela validação de apresentação.",
        {
          hint: "Delegue novamente ao analista com o mesmo escopo. Não reconstrua os números.",
          retryable: true,
        },
      );
    }

    return {
      artifactId: stored.id,
      requestedScope: parsed.data.requestedScope,
      actualScope: parsed.data.actualScope,
      view: parsed.data.view,
      presented: parsed.data.view.kind,
      provenanceCount: viewTransactionIds(parsed.data.view).length,
      note:
        "Painel apresentado a partir do artefato validado. Responda em 2-3 frases sem repetir os números.",
    };
  },
});
