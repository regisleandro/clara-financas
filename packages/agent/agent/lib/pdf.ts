import { readFile } from "node:fs/promises";

import { extractText, getDocumentProxy } from "unpdf";

/**
 * Extração da camada de texto de um PDF.
 *
 * Determinística e sem modelo: o que sai daqui é o que está no arquivo. A
 * interpretação de layout — o que é data, o que é valor, o que é parcela —
 * fica com o extrator.
 */

export class PdfPasswordRequiredError extends Error {
  constructor() {
    super("PDF protegido por senha.");
    this.name = "PdfPasswordRequiredError";
  }
}

export type PdfPage = { page: number; text: string };

export type ExtractedPdf = {
  totalPages: number;
  pages: PdfPage[];
};

export type ExtractOptions = {
  password?: string;
  fromPage?: number;
  toPage?: number;
};

/**
 * Carrega o PDF a partir da chave de armazenamento.
 *
 * Em desenvolvimento a chave é um caminho de arquivo; em produção passa a ser
 * uma chave do Vercel Blob. O ponto de troca é só este.
 */
async function loadPdf(blobKey: string): Promise<Uint8Array> {
  if (blobKey.startsWith("http://") || blobKey.startsWith("https://")) {
    const response = await fetch(blobKey);
    if (!response.ok) {
      throw new Error(`não foi possível baixar o documento (${response.status})`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  return new Uint8Array(await readFile(blobKey));
}

export async function extractPdfText(
  blobKey: string,
  options: ExtractOptions = {},
): Promise<ExtractedPdf> {
  const data = await loadPdf(blobKey);

  let pdf;
  try {
    pdf = await getDocumentProxy(data, { password: options.password });
  } catch (error) {
    if (isPasswordError(error)) throw new PdfPasswordRequiredError();
    throw error;
  }

  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const allPages: string[] = Array.isArray(text) ? text : [text];

  const from = Math.max(1, options.fromPage ?? 1);
  const to = Math.min(totalPages, options.toPage ?? totalPages);

  const pages: PdfPage[] = [];
  for (let page = from; page <= to; page += 1) {
    pages.push({ page, text: (allPages[page - 1] ?? "").trim() });
  }

  return { totalPages, pages };
}

/**
 * O pdf.js sinaliza senha por nome de exceção, não por tipo exportado, então a
 * detecção é por string. Frágil o suficiente para merecer o comentário: se um
 * PDF protegido passar batido, é aqui que se olha.
 */
function isPasswordError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "PasswordException" ||
    /password/i.test(error.message) ||
    /encrypted/i.test(error.message)
  );
}
