import { getDb } from "@clara-financas/db";
import { documents } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireTenantCaller } from "../../../lib/tenant";
import { extractPdfText, PdfPasswordRequiredError } from "../../../lib/pdf";

/**
 * Lê a camada de texto de um PDF, página a página.
 *
 * Por que texto e não imagem: a spec restringe a v1 a PDFs nativos digitais,
 * que saem dos emissores com camada de texto íntegra — não há OCR envolvido, e
 * o desafio real é interpretação de layout. Além disso, tools do eve devolvem
 * apenas texto ou JSON, nunca partes de arquivo, então enviar o PDF ao modelo
 * como imagem não é possível por esta via.
 *
 * O documento é buscado pelo id, sempre sob o escopo do tenant do chamador.
 */
export default defineTool({
  description:
    "Lê o texto de um PDF financeiro já enviado, página a página. Use antes de extrair transações. Se o PDF for protegido, informe a senha.",
  inputSchema: z.object({
    documentId: z.string().min(1).describe("ID do documento enviado pela pessoa."),
    password: z
      .string()
      .optional()
      .describe("Senha do PDF, quando protegido. Peça à pessoa antes de tentar adivinhar."),
    fromPage: z.number().int().positive().optional().describe("Primeira página (1-based)."),
    toPage: z.number().int().positive().optional().describe("Última página, inclusive."),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);

    const document = await forTenant(
      tenantId,
      async (tx) => {
        const [row] = await tx
          .select()
          .from(documents)
          .where(and(eq(documents.id, input.documentId), eq(documents.tenantId, tenantId)))
          .limit(1);
        return row;
      },
      getDb(),
    );

    if (!document) {
      // Não distinguimos "não existe" de "é de outro tenant": a diferença
      // vazaria a existência de documentos alheios.
      return { error: "documento não encontrado" as const };
    }

    try {
      const pages = await extractPdfText(document.blobKey, {
        password: input.password,
        fromPage: input.fromPage,
        toPage: input.toPage,
      });

      return {
        documentId: document.id,
        filename: document.filename,
        issuer: document.issuer,
        totalPages: pages.totalPages,
        pages: pages.pages,
      };
    } catch (error) {
      if (error instanceof PdfPasswordRequiredError) {
        return {
          error: "senha_necessaria" as const,
          message:
            "Este PDF é protegido por senha. Peça a senha à pessoa antes de tentar de novo — não tente adivinhar.",
        };
      }
      throw error;
    }
  },
});
