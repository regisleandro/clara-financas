/**
 * O parser que roda no BROWSER, antes de o arquivo subir.
 *
 * Ele não extrai transações e não manda texto a lugar nenhum: abre o PDF, olha
 * as primeiras páginas e joga fora o que leu. O que interessa é a resposta a
 * uma pergunta só — este arquivo é legível? Quem extrai de verdade continua
 * sendo o agente, lendo o PDF do armazenamento.
 *
 * Por que aqui e não no servidor: com o upload indo direto do browser para o
 * Blob, a função nunca vê os bytes, e a validação por assinatura `%PDF-` que
 * existia deixou de ser possível. Um `getDocumentProxy` local prova muito mais
 * que os cinco primeiros bytes — e prova de graça, sem rede.
 *
 * O ganho maior é de tempo. Antes, um PDF escaneado ou protegido subia inteiro,
 * virava linha no banco, virava mensagem no chat, era delegado ao extrator, e
 * só então voltava um erro. Agora a resposta é local e imediata.
 */

export type PdfPrecheck =
  | { status: "ok"; totalPages: number }
  | { status: "protected" }
  | { status: "no_text"; totalPages: number }
  | { status: "unreadable" };

/**
 * Uma capa sem texto é comum; um documento inteiro sem texto é um escaneado.
 * Três páginas separam os dois casos sem varrer uma fatura de 40 páginas na
 * thread principal.
 */
const PAGES_TO_PROBE = 3;

export async function precheckPdf(bytes: Uint8Array): Promise<PdfPrecheck> {
  try {
    // Dinâmico: o pdf.js pesa, e quem só conversa com a Clara nunca o baixa.
    const { getDocumentProxy } = await import("unpdf");

    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      pdf = await getDocumentProxy(bytes);
    } catch (error) {
      return isPasswordError(error) ? { status: "protected" } : { status: "unreadable" };
    }

    const totalPages = pdf.numPages;
    const limit = Math.min(totalPages, PAGES_TO_PROBE);

    for (let number = 1; number <= limit; number += 1) {
      const page = await pdf.getPage(number);
      const content = (await page.getTextContent()) as { items: Array<{ str?: string }> };
      const hasText = content.items.some(
        (item) => typeof item.str === "string" && item.str.trim() !== "",
      );
      if (hasText) return { status: "ok", totalPages };
    }

    return { status: "no_text", totalPages };
  } catch {
    // Falha do próprio parser (build, memória, PDF exótico) não pode barrar o
    // envio: o agente ainda vai tentar ler o arquivo e sabe reclamar sozinho.
    // Este passo é um atalho para o erro comum, não uma autoridade.
    return { status: "unreadable" };
  }
}

/**
 * O pdf.js sinaliza senha por nome de exceção, não por tipo exportado, então a
 * detecção é por string — a mesma heurística de `packages/agent/agent/lib/pdf.ts`.
 * Duplicada porque os dois lados não compartilham pacote; se um PDF protegido
 * passar batido aqui, o agente ainda o pega lá.
 */
function isPasswordError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "PasswordException" ||
    /password/i.test(error.message) ||
    /encrypted/i.test(error.message)
  );
}
