import { precheckPdf } from "@/lib/pdf-precheck";

/**
 * O envio do documento, visto do browser.
 *
 * A ordem importa e é esta: identificar o arquivo (hash), conferir se ele é
 * legível (parser local), perguntar ao servidor o que fazer com ele, e só então
 * — se ainda for preciso — subir os bytes. Cada passo pode encerrar o processo
 * antes do mais caro de todos.
 *
 * Em produção os bytes vão do browser DIRETO para o Blob, sem atravessar a
 * função: é o que tira do caminho o teto de 4,5 MB de corpo de requisição de
 * uma Vercel Function e a viagem dupla que existia (browser → função → Blob).
 * A função só recebe uma linha de registro depois.
 */

export type UploadOutcome =
  | {
      ok: true;
      documentId: string;
      filename: string;
      reused: boolean;
      /** Recado para a pessoa quando o envio segue, mas com ressalva. */
      warning: string | null;
    }
  | { ok: false; error: string };

/** Acima disto o upload direto é fatiado: partes em paralelo, com retry. */
const MULTIPART_THRESHOLD = 8 * 1024 * 1024;

export async function uploadDocument(
  file: File,
  onProgress?: (percentage: number) => void,
): Promise<UploadOutcome> {
  if (globalThis.crypto?.subtle === undefined) {
    return { ok: false, error: "Envio disponível apenas em conexão segura (HTTPS)." };
  }

  const buffer = await file.arrayBuffer();
  if (!looksLikePdf(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 5)))) {
    return { ok: false, error: "Esse arquivo não é um PDF." };
  }

  const contentHash = await sha256Hex(buffer);

  // Cópia: o pdf.js assume a posse do buffer que recebe, e o original ainda
  // será lido pelo upload. Sem ela, o segundo uso encontra um buffer vazio.
  const precheck = await precheckPdf(new Uint8Array(buffer.slice(0)));

  if (precheck.status === "no_text") {
    return {
      ok: false,
      error:
        "Esse PDF não tem texto — parece um documento escaneado. " +
        "A Clara lê a camada de texto do arquivo, então peça ao emissor a versão digital.",
    };
  }

  // Protegido não impede: o agente pede a senha na conversa, como sempre pediu.
  // Só o aviso muda de lugar, e chega antes em vez de depois.
  const warning =
    precheck.status === "protected"
      ? "Esse PDF está protegido por senha — a Clara vai pedir a senha para ler."
      : null;

  const prepared = await prepare(file, contentHash);
  if (!prepared.ok) return prepared;

  if (prepared.mode === "reused") {
    return {
      ok: true,
      documentId: prepared.documentId,
      filename: prepared.filename,
      reused: true,
      warning,
    };
  }

  const registered =
    prepared.mode === "direct"
      ? await uploadDirect(file, contentHash, prepared.pathname, onProgress)
      : await uploadThroughFunction(file);

  if (!registered.ok) return registered;
  return { ...registered, warning };
}

type Prepared =
  | { ok: true; mode: "reused"; documentId: string; filename: string }
  | { ok: true; mode: "direct"; pathname: string }
  | { ok: true; mode: "proxy" }
  | { ok: false; error: string };

async function prepare(file: File, contentHash: string): Promise<Prepared> {
  const response = await fetch("/api/documents/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentHash, size: file.size }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    mode?: "reused" | "direct" | "proxy";
    documentId?: string;
    filename?: string;
    pathname?: string;
    error?: string;
  };

  if (!response.ok || data.mode === undefined) {
    return { ok: false, error: data.error ?? "Não foi possível enviar o arquivo." };
  }
  if (data.mode === "reused" && data.documentId !== undefined) {
    return { ok: true, mode: "reused", documentId: data.documentId, filename: data.filename ?? file.name };
  }
  if (data.mode === "direct" && data.pathname !== undefined) {
    return { ok: true, mode: "direct", pathname: data.pathname };
  }
  return { ok: true, mode: "proxy" };
}

type Registered = { ok: true; documentId: string; filename: string; reused: boolean } | { ok: false; error: string };

/**
 * Browser → Blob, direto. O caminho é o que o servidor derivou, e o token que o
 * autoriza é emitido em /api/documents/upload — vinculado a este caminho, a
 * este tipo e a este tamanho.
 *
 * `private` continua sendo a propriedade que importa: uma fatura num URL
 * público fica legível para sempre por quem obtiver o URL.
 */
async function uploadDirect(
  file: File,
  contentHash: string,
  pathname: string,
  onProgress?: (percentage: number) => void,
): Promise<Registered> {
  try {
    const { upload } = await import("@vercel/blob/client");

    const blob = await upload(pathname, file, {
      access: "private",
      contentType: "application/pdf",
      handleUploadUrl: "/api/documents/upload",
      multipart: file.size > MULTIPART_THRESHOLD,
      onUploadProgress: ({ percentage }) => onProgress?.(percentage),
    });

    return register({
      url: blob.url,
      pathname: blob.pathname,
      filename: file.name,
      contentHash,
    });
  } catch (error) {
    // O SDK engole a resposta da nossa rota e lança "Failed to retrieve the
    // client token" — em inglês e sem a causa. Repassá-lo à pessoa seria pior
    // que uma frase honesta; o original fica no console, para quem depura.
    console.error("upload direto falhou", error);
    return { ok: false, error: "Não foi possível enviar o arquivo. Tente de novo." };
  }
}

/** Desenvolvimento sem conta de Blob: o arquivo vai pela função, para o disco. */
async function uploadThroughFunction(file: File): Promise<Registered> {
  const body = new FormData();
  body.append("file", file);
  return read(await fetch("/api/documents", { method: "POST", body }));
}

async function register(payload: {
  url: string;
  pathname: string;
  filename: string;
  contentHash: string;
}): Promise<Registered> {
  return read(
    await fetch("/api/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

async function read(response: Response): Promise<Registered> {
  const data = (await response.json().catch(() => ({}))) as {
    documentId?: string;
    filename?: string;
    reused?: boolean;
    error?: string;
  };

  if (!response.ok || data.documentId === undefined) {
    return { ok: false, error: data.error ?? "Não foi possível enviar o arquivo." };
  }

  return {
    ok: true,
    documentId: data.documentId,
    filename: data.filename ?? "documento.pdf",
    reused: data.reused === true,
  };
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Assinatura de PDF: `%PDF-`. Espelha `looksLikePdf` do servidor. */
function looksLikePdf(head: Uint8Array): boolean {
  return (
    head.length > 4 &&
    head[0] === 0x25 &&
    head[1] === 0x50 &&
    head[2] === 0x44 &&
    head[3] === 0x46 &&
    head[4] === 0x2d
  );
}
