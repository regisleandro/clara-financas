/**
 * Persistência local da conversa.
 *
 * Recarregar a página perdia a conversa inteira: o histórico de mensagens é
 * propriedade do `useEveAgent`, e nada o guardava. O eve suporta retomada
 * nativamente — basta persistir o cursor (`SessionState`) e os eventos e
 * semeá-los na montagem (`initialSession`/`initialEvents`).
 *
 * localStorage, por tenant, com um registro pequeno de conversas. É retomada
 * LOCAL por decisão de escopo: cross-device exigiria endpoint próprio sobre
 * `agent_sessions`. O lado servidor da segurança está no canal do agente
 * (ACL de sessão em `channels/eve.ts`) — o storage aqui é conveniência, não
 * autorização.
 *
 * Módulo puro fora do DOM: toda função aceita um `Storage` (default
 * `window.localStorage`) e devolve algo inerte quando não há storage — o
 * Next renderiza client components no servidor, e `localStorage` lá não
 * existe.
 */

export type SessionCursor = {
  continuationToken?: string;
  sessionId?: string;
  streamIndex: number;
};

export type StoredConversation = {
  sessionId: string;
  /** Primeira mensagem da pessoa, truncada — o título da conversa. */
  title: string;
  updatedAt: number;
};

export type StoredSession = {
  cursor: SessionCursor;
  events: readonly unknown[];
  /** true quando os eventos foram descartados por tamanho: o cursor retoma a
   * sessão, mas o histórico visual daquela conversa não volta. */
  eventsDropped?: boolean;
};

/**
 * Teto do JSON de eventos por conversa. localStorage tem ~5 MB por origem;
 * acima do teto guardamos só o cursor — a retomada continua funcionando e a
 * UI avisa que o histórico visual ficou para trás.
 */
const MAX_EVENTS_JSON_BYTES = 500_000;
const MAX_CONVERSATIONS = 20;
const TITLE_MAX = 80;

const registryKey = (tenantKey: string) => `clara:conversations:${tenantKey}`;
const sessionKey = (tenantKey: string, sessionId: string) =>
  `clara:session:${tenantKey}:${sessionId}`;

function defaultStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Safari em navegação privada e iframes com storage bloqueado lançam.
    return null;
  }
}

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // QuotaExceeded ou storage bloqueado: falhar em silêncio é correto aqui —
    // persistir é conveniência, e a conversa em memória segue intacta.
    return false;
  }
}

const recordOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

/**
 * Respostas sensíveis de `ask_question` não entram no histórico local. O Eve
 * mantém os metadados necessários para retomar a sessão; para a UI basta
 * registrar que a pergunta foi respondida.
 */
function redactSensitiveResponses(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveResponses);
  const record = recordOf(value);
  if (record === null) return value;

  const request = recordOf(record.inputRequest);
  const prompt = typeof request?.prompt === "string" ? request.prompt : "";
  const sensitive = /senha|password/i.test(prompt);

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (sensitive && key === "inputResponse") {
      const response = recordOf(child);
      sanitized[key] =
        response === null
          ? child
          : {
              ...response,
              ...(typeof response.text === "string" ? { text: "[resposta protegida]" } : {}),
            };
      continue;
    }
    sanitized[key] = redactSensitiveResponses(child);
  }
  return sanitized;
}

export function listConversations(
  tenantKey: string,
  storage: Storage | null = defaultStorage(),
): StoredConversation[] {
  if (storage === null) return [];
  const list = readJson<StoredConversation[]>(storage, registryKey(tenantKey));
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (entry): entry is StoredConversation =>
        typeof entry?.sessionId === "string" && typeof entry?.updatedAt === "number",
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function latestConversation(
  tenantKey: string,
  storage: Storage | null = defaultStorage(),
): StoredConversation | null {
  return listConversations(tenantKey, storage)[0] ?? null;
}

export function loadSession(
  tenantKey: string,
  sessionId: string,
  storage: Storage | null = defaultStorage(),
): StoredSession | null {
  if (storage === null) return null;
  const stored = readJson<StoredSession>(storage, sessionKey(tenantKey, sessionId));
  if (stored === null || typeof stored.cursor !== "object") return null;
  return stored;
}

/**
 * Grava cursor + eventos de uma conversa e a promove no registro.
 *
 * `title` só é aplicado se a conversa ainda não tem um — o título é a
 * primeira mensagem, não a última.
 */
export function saveSession(
  tenantKey: string,
  cursor: SessionCursor,
  events: readonly unknown[],
  title: string | null,
  storage: Storage | null = defaultStorage(),
): void {
  if (storage === null) return;
  const sessionId = cursor.sessionId;
  if (sessionId === undefined || sessionId === "") return;

  let payload: StoredSession = {
    cursor,
    events: redactSensitiveResponses(events) as readonly unknown[],
  };
  const json = JSON.stringify(payload);
  if (json.length > MAX_EVENTS_JSON_BYTES) {
    payload = { cursor, events: [], eventsDropped: true };
  }
  writeJson(storage, sessionKey(tenantKey, sessionId), payload);

  const existing = listConversations(tenantKey, storage);
  const current = existing.find((entry) => entry.sessionId === sessionId);
  const rest = existing.filter((entry) => entry.sessionId !== sessionId);
  const next: StoredConversation[] = [
    {
      sessionId,
      title: current?.title ?? truncateTitle(title ?? "Conversa"),
      updatedAt: Date.now(),
    },
    ...rest,
  ].slice(0, MAX_CONVERSATIONS);

  // Conversas que saíram do registro não podem deixar órfãos ocupando quota.
  for (const dropped of existing.slice(MAX_CONVERSATIONS)) {
    try {
      storage.removeItem(sessionKey(tenantKey, dropped.sessionId));
    } catch {
      // storage bloqueado: nada a fazer.
    }
  }

  writeJson(storage, registryKey(tenantKey), next);
}

export function removeConversation(
  tenantKey: string,
  sessionId: string,
  storage: Storage | null = defaultStorage(),
): void {
  if (storage === null) return;
  try {
    storage.removeItem(sessionKey(tenantKey, sessionId));
  } catch {
    // storage bloqueado: o registro abaixo ainda é atualizável ou não; ambos ok.
  }
  const rest = listConversations(tenantKey, storage).filter(
    (entry) => entry.sessionId !== sessionId,
  );
  writeJson(storage, registryKey(tenantKey), rest);
}

function truncateTitle(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean === "") return "Conversa";
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1)}…` : clean;
}
