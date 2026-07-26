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
const activeKey = (tenantKey: string) => `clara:active:${tenantKey}`;

/**
 * Qual conversa está ABERTA no dispositivo. `sessionId: null` é uma conversa
 * nova em aberto — diferente de "não há ponteiro", que é o primeiro acesso.
 */
type ActivePointer = { sessionId: string | null };

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

/**
 * Aponta qual conversa está aberta. `null` = conversa nova: quem recarrega a
 * página depois de clicar em "Nova conversa" NÃO deve receber a antiga de volta.
 */
export function setActiveConversation(
  tenantKey: string,
  sessionId: string | null,
  storage: Storage | null = defaultStorage(),
): void {
  if (storage === null) return;
  writeJson(storage, activeKey(tenantKey), { sessionId } satisfies ActivePointer);
}

/**
 * A conversa a retomar ao abrir a página.
 *
 * É o PONTEIRO, não a data: ordenar por `updatedAt` fazia a retomada depender
 * de qual gravação venceu a corrida — uma conversa cujo turno fechou sem
 * cursor (ver `saveSession`) nunca subia no registro, e a página voltava numa
 * conversa antiga qualquer. O ponteiro é escrito quando a conversa é aberta ou
 * criada, então ele é a resposta exata para "onde eu estava".
 *
 * Sem ponteiro (primeiro acesso, storage limpo) ou apontando para uma conversa
 * que já não existe, cai na mais recente — melhor que abrir em branco quem tem
 * histórico.
 */
export function activeConversation(
  tenantKey: string,
  storage: Storage | null = defaultStorage(),
): string | null {
  if (storage === null) return null;
  const known = listConversations(tenantKey, storage);
  const fallback = known[0]?.sessionId ?? null;

  const pointer = readJson<ActivePointer>(storage, activeKey(tenantKey));
  if (pointer === null || typeof pointer !== "object") return fallback;
  if (pointer.sessionId === null) return null;
  if (typeof pointer.sessionId !== "string") return fallback;

  return known.some((entry) => entry.sessionId === pointer.sessionId)
    ? pointer.sessionId
    : fallback;
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
 * Grava cursor + eventos de uma conversa, a promove no registro e a marca como
 * a conversa aberta.
 *
 * `title` só é aplicado se a conversa ainda não tem um — o título é a
 * primeira mensagem, não a última.
 *
 * Cursor sem `sessionId` não é gravável: retomar exige o id. Quando isso
 * acontece o silêncio é a pior saída — a conversa some do registro sem rastro,
 * e a página volta noutra. Ver `preserveCompletedSessions` em
 * `use-clara-agent.ts`, que é o que mantém o cursor vivo entre turnos.
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
  if (sessionId === undefined || sessionId === "") {
    if (events.length > 0) {
      console.warn(
        "[clara] turno terminou sem cursor de sessão: esta conversa não pôde ser guardada para retomada.",
      );
    }
    return;
  }

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

  // Conversas que saíram do registro não podem deixar órfãos ocupando quota —
  // e quota estourada faz `setItem` falhar em silêncio, o que arruína a
  // retomada de todo mundo. Compara com o registro NOVO: `existing` já vinha
  // no teto, então cortar por índice nunca achava a conversa expulsa.
  const kept = new Set(next.map((entry) => entry.sessionId));
  for (const dropped of existing) {
    if (kept.has(dropped.sessionId)) continue;
    try {
      storage.removeItem(sessionKey(tenantKey, dropped.sessionId));
    } catch {
      // storage bloqueado: nada a fazer.
    }
  }

  writeJson(storage, registryKey(tenantKey), next);

  // Uma conversa nova só tem id depois do primeiro turno; é aqui que o
  // ponteiro passa de "conversa nova" para ela.
  setActiveConversation(tenantKey, sessionId, storage);
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

  // Ponteiro pendurado numa conversa removida abriria em branco na próxima
  // visita; o fallback do `activeConversation` cobre isso, mas o ponteiro
  // mentiroso não precisa sobreviver.
  const pointer = readJson<ActivePointer>(storage, activeKey(tenantKey));
  if (pointer?.sessionId === sessionId) setActiveConversation(tenantKey, null, storage);
}

function truncateTitle(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean === "") return "Conversa";
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1)}…` : clean;
}
