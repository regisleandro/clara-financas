import { openSealedInput } from "@clara-financas/auth/sealed-input";
import { getDb } from "@clara-financas/db";
import { documents } from "@clara-financas/db/schema/ledger";
import { forTenant } from "@clara-financas/db/tenant-scope";
import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { notFound, refused, toolError } from "../../../lib/errors";
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
    "Reads the text of an already-uploaded financial PDF, page by page. Use before extracting transactions. If the PDF is protected, supply the short-lived sealed password token.",
  inputSchema: z.object({
    documentId: z.string().min(1).describe("Id of the document the person uploaded."),
    passwordToken: z
      .string()
      .optional()
      .describe("Short-lived sealed password token, when protected. Never ask for plaintext."),
    fromPage: z.number().int().positive().optional().describe("First page (1-based)."),
    toPage: z.number().int().positive().optional().describe("Last page, inclusive."),
  }),
  async execute(input, ctx) {
    const { tenantId } = requireTenantCaller(ctx);
    let password: string | undefined;

    if (input.passwordToken) {
      const secret = process.env.AGENT_TOKEN_SECRET;
      if (!secret) throw new Error("AGENT_TOKEN_SECRET não configurado");

      const invalidCredential = () =>
        refused("credencial_invalida", "O token de senha não é válido para este documento.", {
          hint: "Peça a senha de novo com ask_question e allowFreeform — o token expira em minutos e não se reaproveita.",
        });

      try {
        const sealed = await openSealedInput(input.passwordToken, secret);
        if (sealed.tenantId !== tenantId || sealed.purpose !== "pdf_password") {
          return invalidCredential();
        }
        password = sealed.value;
      } catch {
        return invalidCredential();
      }
    }

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
      return notFound("documento_nao_encontrado", "Nenhum documento com esse id.", {
        hint: "Use o documentId exatamente como veio na requisição do coordenador.",
      });
    }

    try {
      const pages = await extractPdfText(document.blobKey, {
        password,
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
        return toolError("senha_necessaria", "Este PDF é protegido por senha.", {
          hint: "Devolva o aviso ao coordenador: a senha chega por ask_question protegida, nunca em texto puro. Não adivinhe.",
          retryable: true,
        });
      }
      throw error;
    }
  },
});
