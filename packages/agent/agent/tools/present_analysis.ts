import { AnalysisArtifactSchema } from "@clara-financas/views/agent-contracts";
import { viewTransactionIds, type View } from "@clara-financas/views";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { readArtifact } from "../lib/artifacts";
import { toolError } from "../lib/errors";

/**
 * Apresenta os painéis de uma análise pelos ids opacos que o recibo trouxe.
 *
 * Aceita LISTA porque uma resposta pode ter mais de um painel — a composição e
 * a comparação, a proposta e o resultado. O contrato aceitava um só enquanto as
 * instruções mandavam passar "a lista completa de `artifactIds`"; o modelo
 * obedecia à instrução, a validação reprovava a forma, e o turno morria sem
 * nenhuma tool ter falhado.
 */
export default defineTool({
  description:
    "Presents an analysis by the opaque artifactIds from the analyst receipt, in order. Use immediately after the analyst returns a receipt, passing every id it listed. Never rebuild or copy its numbers into present_view.",
  inputSchema: z.object({
    artifactIds: z
      .array(z.string().regex(/^art_[a-z0-9]+$/))
      .min(1)
      .max(4)
      .describe("Every artifactId from the receipt, in the order they should be presented."),
  }),
  async execute(input, ctx) {
    const views: View[] = [];
    const presented: string[] = [];
    const scopes: Array<{ requestedScope: unknown; actualScope: unknown }> = [];

    for (const artifactId of input.artifactIds) {
      const stored = await readArtifact<unknown>(artifactId, "analysis", ctx);
      // Um id ruim no meio da lista não pode virar meia apresentação: ou os
      // painéis daquela resposta aparecem juntos, ou a recusa diz o que houve.
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

      views.push(parsed.data.view);
      presented.push(parsed.data.view.kind);
      scopes.push({
        requestedScope: parsed.data.requestedScope,
        actualScope: parsed.data.actualScope,
      });
    }

    return {
      artifactIds: input.artifactIds,
      scopes,
      views,
      presented,
      provenanceCount: views.reduce((total, view) => total + viewTransactionIds(view).length, 0),
      note:
        views.length === 1
          ? "Painel apresentado a partir do artefato validado. Responda em 2-3 frases sem repetir os números."
          : `${views.length} painéis apresentados a partir dos artefatos validados. Responda em 2-3 frases sem repetir os números.`,
    };
  },
});
