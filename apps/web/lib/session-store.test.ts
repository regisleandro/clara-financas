import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  armResume,
  clearResume,
  latestConversation,
  listConversations,
  loadSession,
  removeConversation,
  resumeTarget,
  saveSession,
} from "./session-store";

/**
 * O módulo é puro fora do DOM: todas as funções aceitam um Storage explícito,
 * e é assim que os testes rodam em Node — o mesmo caminho que o SSR exercita
 * quando devolve o storage nulo.
 */

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

const cursor = (sessionId: string) => ({ sessionId, streamIndex: 3 });

describe("session-store", () => {
  it("grava e retoma uma conversa", () => {
    const storage = memoryStorage();
    saveSession("t1", cursor("s1"), [{ type: "turn.started" }], "Quanto gastei?", storage);

    const stored = loadSession("t1", "s1", storage);
    assert.equal(stored?.cursor.sessionId, "s1");
    assert.equal(stored?.events.length, 1);
    assert.equal(latestConversation("t1", storage)?.title, "Quanto gastei?");
  });

  it("sem sessionId no cursor, não grava nada", () => {
    const storage = memoryStorage();
    saveSession("t1", { streamIndex: 0 }, [], "x", storage);
    assert.deepEqual(listConversations("t1", storage), []);
  });

  it("o título é a PRIMEIRA mensagem — gravações seguintes não o trocam", () => {
    const storage = memoryStorage();
    saveSession("t1", cursor("s1"), [], "Primeira pergunta", storage);
    saveSession("t1", cursor("s1"), [], "Segunda pergunta", storage);
    assert.equal(latestConversation("t1", storage)?.title, "Primeira pergunta");
  });

  it("conversa longa demais mantém o cursor e descarta os eventos, avisando", () => {
    const storage = memoryStorage();
    const bigEvents = Array.from({ length: 2000 }, (_, index) => ({
      type: "message.appended",
      data: { text: `um texto razoavelmente comprido para estourar o teto ${index}`.repeat(10) },
    }));
    saveSession("t1", cursor("s1"), bigEvents, "Longa", storage);

    const stored = loadSession("t1", "s1", storage);
    assert.equal(stored?.eventsDropped, true);
    assert.equal(stored?.events.length, 0);
    assert.equal(stored?.cursor.sessionId, "s1", "a retomada continua possível");
  });

  it("não persiste senha respondida em um pedido protegido", () => {
    const storage = memoryStorage();
    const events = [
      {
        type: "message.appended",
        data: {
          parts: [
            {
              toolMetadata: {
                eve: {
                  inputRequest: { prompt: "Qual é a senha deste PDF?" },
                  inputResponse: { text: "segredo-real" },
                },
              },
            },
          ],
        },
      },
    ];

    saveSession("t1", cursor("s1"), events, "Documento", storage);
    const raw = storage.getItem("clara:session:t1:s1") ?? "";

    assert.equal(raw.includes("segredo-real"), false);
    assert.equal(raw.includes("[resposta protegida]"), true);
  });

  it("tenants não se enxergam", () => {
    const storage = memoryStorage();
    saveSession("t1", cursor("s1"), [], "Do tenant 1", storage);
    assert.equal(latestConversation("t2", storage), null);
    assert.equal(loadSession("t2", "s1", storage), null);
  });

  it("remover uma conversa some do registro e do storage", () => {
    const storage = memoryStorage();
    saveSession("t1", cursor("s1"), [], "A", storage);
    saveSession("t1", cursor("s2"), [], "B", storage);
    removeConversation("t1", "s2", storage);

    assert.equal(loadSession("t1", "s2", storage), null);
    assert.deepEqual(
      listConversations("t1", storage).map((entry) => entry.sessionId),
      ["s1"],
    );
  });

  it("chegar à tela sem bilhete começa limpo, mesmo com histórico", () => {
    const storage = memoryStorage();
    const tab = memoryStorage();
    saveSession("t1", cursor("s1"), [{ type: "turn.started" }], "Antiga", storage);
    saveSession("t1", cursor("s2"), [{ type: "turn.started" }], "Recente", storage);

    // O histórico continua lá, alcançável pelo menu — o que não acontece mais
    // é ele decidir sozinho onde a próxima visita abre.
    assert.equal(resumeTarget("t1", tab, storage), null);
    assert.equal(latestConversation("t1", storage)?.sessionId, "s2");
  });

  it("sair com um turno no ar é o que faz voltar para a conversa", () => {
    const storage = memoryStorage();
    const tab = memoryStorage();
    saveSession("t1", cursor("s1"), [{ type: "turn.started" }], "Em andamento", storage);

    armResume("t1", "s1", tab);
    assert.equal(resumeTarget("t1", tab, storage), "s1");
  });

  it("o turno assentado desarma a retomada", () => {
    const storage = memoryStorage();
    const tab = memoryStorage();
    saveSession("t1", cursor("s1"), [{ type: "turn.started" }], "Terminada", storage);

    armResume("t1", "s1", tab);
    clearResume("t1", tab);
    assert.equal(resumeTarget("t1", tab, storage), null);
  });

  it("o bilhete vive na aba: navegador novo chega sem ele", () => {
    const storage = memoryStorage();
    const tab = memoryStorage();
    saveSession("t1", cursor("s1"), [{ type: "turn.started" }], "Em andamento", storage);
    armResume("t1", "s1", tab);

    // Uma aba nova é um `sessionStorage` novo; o `localStorage` é o mesmo.
    const outraAba = memoryStorage();
    assert.equal(resumeTarget("t1", outraAba, storage), null);
  });

  it("bilhete para conversa que já não existe começa limpo", () => {
    const storage = memoryStorage();
    const tab = memoryStorage();
    saveSession("t1", cursor("s1"), [{ type: "turn.started" }], "A", storage);
    armResume("t1", "fantasma", tab);
    assert.equal(resumeTarget("t1", tab, storage), null);
  });

  it("remover a conversa retomável apaga o bilhete", () => {
    const storage = memoryStorage();
    const tab = memoryStorage();
    saveSession("t1", cursor("s1"), [{ type: "turn.started" }], "A", storage);
    armResume("t1", "s1", tab);

    removeConversation("t1", "s1", storage, tab);
    assert.equal(tab.getItem("clara:resume:t1"), null);
    assert.equal(resumeTarget("t1", tab, storage), null);
  });

  it("bilhete de outro tenant não atravessa", () => {
    const storage = memoryStorage();
    const tab = memoryStorage();
    saveSession("t1", cursor("s1"), [{ type: "turn.started" }], "A", storage);
    armResume("t1", "s1", tab);
    assert.equal(resumeTarget("t2", tab, storage), null);
  });

  it("registro corrompido devolve vazio em vez de quebrar", () => {
    const storage = memoryStorage();
    storage.setItem("clara:conversations:t1", "{não é json");
    assert.deepEqual(listConversations("t1", storage), []);
  });
});
