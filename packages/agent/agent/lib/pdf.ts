import { readFile } from "node:fs/promises";

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

type MathWithSumPrecise = Math & {
  sumPrecise?: (values: Iterable<number>) => number;
};

/**
 * O pdf.js empacotado pelo unpdf 1.8 usa `Math.sumPrecise`, mas o Node 24
 * ainda não expõe essa API. Instalamos o fallback antes do import dinâmico do
 * unpdf para manter o contrato de engine declarado pela própria dependência.
 *
 * O algoritmo de Neumaier preserva melhor as somas de larguras e offsets do
 * PDF do que um `reduce` simples. Quando o runtime ganhar a API nativa, este
 * caminho deixa de fazer qualquer alteração global.
 */
function ensureMathSumPrecise(): void {
  const math = Math as MathWithSumPrecise;
  if (typeof math.sumPrecise === "function") return;

  Object.defineProperty(math, "sumPrecise", {
    configurable: true,
    writable: true,
    value(values: Iterable<number>): number {
      let sum = 0;
      let correction = 0;

      for (const value of values) {
        const next = sum + value;
        if (Math.abs(sum) >= Math.abs(value)) {
          correction += sum - next + value;
        } else {
          correction += value - next + sum;
        }
        sum = next;
      }

      return sum + correction;
    },
  });
}

/**
 * Carrega o PDF a partir da chave de armazenamento.
 *
 * Em desenvolvimento a chave é um caminho de arquivo; em produção é um blob do
 * Vercel, gravado com acesso PRIVADO. O ponto de troca é só este.
 *
 * Privado muda como se lê: um `fetch` cru no URL não basta mais, porque o blob
 * exige autenticação — e é exatamente esse o ponto. O SDK anexa o token do
 * store. Se o `fetch` cru voltar a funcionar num documento destes, é sinal de
 * que alguém regrediu o armazenamento para público.
 */
async function loadPdf(blobKey: string): Promise<Uint8Array> {
  if (blobKey.startsWith("http://") || blobKey.startsWith("https://")) {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (typeof token !== "string" || token.length === 0) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN não está definida nesta instância do agente. " +
          "Os documentos são privados e não podem ser lidos sem o token do store.",
      );
    }

    const { get } = await import("@vercel/blob");
    const result = await get(blobKey, { access: "private", token });

    if (result === null || result.statusCode !== 200 || result.stream === null) {
      throw new Error(`não foi possível baixar o documento (${result?.statusCode ?? "sem resposta"})`);
    }

    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }

  return new Uint8Array(await readFile(blobKey));
}

export async function extractPdfText(
  blobKey: string,
  options: ExtractOptions = {},
): Promise<ExtractedPdf> {
  const data = await loadPdf(blobKey);

  ensureMathSumPrecise();
  const { extractText, getDocumentProxy } = await import("unpdf");

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
