import { FinancialArtifactSchema } from "@clara-financas/views";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { toolError } from "../lib/errors";
import { readPublishedArtifact } from "../lib/v3-state";

export default defineTool({
  description:
    "Presents a validated v3 financial artifact by its opaque artifactId. Call immediately after analyze_series returns. Never copy or rebuild its values.",
  inputSchema: z.object({ artifactId: z.string().regex(/^art_[a-z0-9]+$/) }),
  async execute(input, ctx) {
    const stored = await readPublishedArtifact(input.artifactId, ctx);
    if (stored === null) {
      return toolError(
        "artefato_nao_encontrado",
        "O artefato financeiro não foi encontrado nesta conversa.",
        { hint: "Delegue novamente a análise preservando os mesmos períodos.", retryable: true },
      );
    }

    const parsed = FinancialArtifactSchema.safeParse(stored.payload);
    if (!parsed.success) {
      return toolError(
        "artefato_invalido",
        "A análise foi calculada, mas o artefato não passou pela validação de apresentação.",
        { hint: "Delegue novamente a análise com os mesmos períodos.", retryable: true },
      );
    }

    return {
      artifactId: stored.id,
      artifact: parsed.data,
      presented: parsed.data.kind,
      blockCount: parsed.data.blocks.length,
      note:
        "Artefato financeiro apresentado a partir do cálculo determinístico. Responda em 2-3 frases sem repetir os números do painel.",
    };
  },
});
