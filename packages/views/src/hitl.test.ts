import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findCommittedBatchIds,
  findRejectedBatchIds,
  findBatchProposals,
  resolveApprovalOption,
  findOpenBatchProposal,
  findOpenBatchProposalLocation,
  findPendingRequest,
} from "./hitl";

/**
 * O caso que trava a tela e que não era coberto: um pedido de aprovação já
 * respondido continua com `inputRequest` na parte, porque o eve guarda pedido e
 * resposta lado a lado. Quem lê só o pedido responde a um `requestId` morto, o
 * turno não retoma, e a interface fica "processando" indefinidamente.
 */

const toolPart = (over: Record<string, unknown> = {}) => ({
  type: "dynamic-tool",
  toolName: "commit_batch",
  input: { batchId: "bat_1" },
  toolMetadata: { eve: { kind: "tool-call", name: "commit_batch", ...(over.eve ?? {}) } },
  ...over,
});

const request = (requestId = "req_1") => ({
  requestId,
  prompt: "Registrar?",
  options: [{ id: "approve", label: "Aprovar" }],
});

const msg = (...parts: unknown[]) => ({ id: "m", role: "assistant", parts });

describe("findPendingRequest", () => {
  it("encontra um pedido que ainda espera decisão", () => {
    const found = findPendingRequest([msg(toolPart({ eve: { inputRequest: request() } }))]);
    assert.equal(found?.requestId, "req_1");
    assert.equal(found?.toolName, "commit_batch");
  });

  it("IGNORA pedido já respondido — a causa do travamento", () => {
    const found = findPendingRequest([
      msg(
        toolPart({
          eve: { inputRequest: request(), inputResponse: { optionId: "approve" } },
        }),
      ),
    ]);
    assert.equal(found, null);
  });

  it("ignora pedido cuja tool já produziu resultado", () => {
    const found = findPendingRequest([
      msg(
        toolPart({
          eve: { inputRequest: request() },
          output: { batchId: "bat_1", status: "confirmed" },
        }),
      ),
    ]);
    assert.equal(found, null);
  });

  it("um pedido antigo respondido não esconde um novo pendente", () => {
    const found = findPendingRequest([
      msg(
        toolPart({
          eve: { inputRequest: request("req_velho"), inputResponse: { optionId: "approve" } },
        }),
      ),
      msg(toolPart({ eve: { inputRequest: request("req_novo") } })),
    ]);
    assert.equal(found?.requestId, "req_novo");
  });

  it("carrega o input da tool, que alimenta o cartão", () => {
    const found = findPendingRequest([msg(toolPart({ eve: { inputRequest: request() } }))]);
    assert.deepEqual(found?.toolInput, { batchId: "bat_1" });
  });

  it("sem mensagem alguma, não há pendência", () => {
    assert.equal(findPendingRequest([]), null);
    assert.equal(findPendingRequest(undefined), null);
  });

  it("aguenta partes malformadas", () => {
    const found = findPendingRequest([
      null,
      { parts: "não é lista" },
      msg({ type: "text" }, null),
      msg(toolPart({ eve: { inputRequest: request() } })),
    ]);
    assert.equal(found?.requestId, "req_1");
  });
});

describe("findOpenBatchProposal", () => {
  const proposal = (batchId: string) => ({
    type: "dynamic-tool",
    toolName: "propose_batch",
    output: { batchId, checksum: { result: "match", extractedTotal: 100 } },
  });

  const commit = (batchId: string) => ({
    type: "dynamic-tool",
    toolName: "commit_batch",
    output: { batchId, status: "confirmed", confirmedTransactions: 44 },
  });

  it("devolve a proposta enquanto o lote não foi registrado", () => {
    const found = findOpenBatchProposal([msg(proposal("bat_1"))]);
    assert.equal(found?.batchId, "bat_1");
  });

  it("some depois do registro — o cartão não pode sobreviver ao commit", () => {
    const found = findOpenBatchProposal([msg(proposal("bat_1")), msg(commit("bat_1"))]);
    assert.equal(found, null);
  });

  it("uma proposta nova reabre o cartão depois de um registro anterior", () => {
    const found = findOpenBatchProposal([
      msg(proposal("bat_1")),
      msg(commit("bat_1")),
      msg(proposal("bat_2")),
    ]);
    assert.equal(found?.batchId, "bat_2");
  });

  it("commit sem status confirmado não esconde a proposta", () => {
    const found = findOpenBatchProposal([
      msg(proposal("bat_1")),
      msg({ type: "dynamic-tool", toolName: "commit_batch", output: { error: "falhou" } }),
    ]);
    assert.equal(found?.batchId, "bat_1");
  });
});

describe("findOpenBatchProposalLocation", () => {
  const proposal = (batchId: string) => ({
    type: "dynamic-tool",
    toolName: "propose_batch",
    output: { batchId, checksum: { result: "match", extractedTotal: 100 } },
  });
  const at = (id: string, ...parts: unknown[]) => ({ id, role: "assistant", parts });

  it("diz em qual mensagem o lote aberto nasceu", () => {
    const found = findOpenBatchProposalLocation([
      at("m1", { type: "text" }),
      at("m2", proposal("bat_1")),
    ]);
    assert.equal(found?.messageId, "m2");
    assert.equal(found?.output.batchId, "bat_1");
  });

  it("messageId é null quando a mensagem não tem id", () => {
    const found = findOpenBatchProposalLocation([{ role: "assistant", parts: [proposal("bat_1")] }]);
    assert.equal(found?.messageId, null);
  });

  it("sem proposta aberta, não há localização", () => {
    assert.equal(findOpenBatchProposalLocation([]), null);
  });
});

describe("findCommittedBatchIds", () => {
  it("reúne os lotes registrados", () => {
    const ids = findCommittedBatchIds([
      msg({
        type: "dynamic-tool",
        toolName: "commit_batch",
        output: { batchId: "bat_1", status: "confirmed" },
      }),
    ]);
    assert.deepEqual([...ids], ["bat_1"]);
  });

  it("sem registro, o conjunto é vazio", () => {
    assert.equal(findCommittedBatchIds([]).size, 0);
  });

  it("o cartão fecha quando a fatura é DESCARTADA, não só quando é registrada", () => {
    // Enquanto descartar era uma frase no chat, isto não aparecia. Com a tool
    // escrevendo `rejected` de verdade, o cartão sobrevivia ao próprio lote e
    // seguia oferecendo "Registrar fatura" sobre linhas já apagadas.
    const messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "propose_batch",
            output: { batchId: "bat_1", transactionCount: 4, checksum: { result: "mismatch" } },
          },
        ],
      },
      {
        id: "m2",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "reject_batch",
            output: { batchId: "bat_1", status: "rejected", discardedTransactions: 4 },
          },
        ],
      },
    ];

    assert.equal(findOpenBatchProposalLocation(messages), null);
    assert.deepEqual([...findRejectedBatchIds(messages)], ["bat_1"]);
  });

  it("descartar UMA fatura não fecha o cartão de outra", () => {
    const messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "reject_batch",
            output: { batchId: "bat_1", status: "rejected" },
          },
        ],
      },
      {
        id: "m2",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "propose_batch",
            output: { batchId: "bat_2", transactionCount: 2, checksum: { result: "match" } },
          },
        ],
      },
    ];

    assert.equal(findOpenBatchProposalLocation(messages)?.output.batchId, "bat_2");
  });

  /**
   * A interface mandava as literais `"approve"`/`"deny"` sem olhar o pedido.
   * Enquanto o harness usar esses ids, funciona; no dia em que usar outros, o
   * turno não retoma e os botões ficam mortos — sem erro visível.
   */
  it("aprova pelo id da opção, quando o pedido traz outro vocabulário", () => {
    const pending = {
      options: [
        { optionId: "confirm", label: "Registrar fatura" },
        { optionId: "decline", label: "Agora não" },
      ],
    };

    assert.equal(resolveApprovalOption(pending, "approve"), "confirm");
    assert.equal(resolveApprovalOption(pending, "deny"), "decline");
  });

  it("com id opaco, decide pelo rótulo", () => {
    const pending = {
      options: [
        { optionId: "opt_1", label: "Sim" },
        { optionId: "opt_2", label: "Não" },
      ],
    };

    assert.equal(resolveApprovalOption(pending, "approve"), "opt_1");
    assert.equal(resolveApprovalOption(pending, "deny"), "opt_2");
  });

  it("sem vocabulário reconhecível, primeira é aprovar e última é negar", () => {
    const pending = { options: [{ optionId: "a" }, { optionId: "b" }] };

    assert.equal(resolveApprovalOption(pending, "approve"), "a");
    assert.equal(resolveApprovalOption(pending, "deny"), "b");
  });

  it("sem opções, a literal é a única informação que existe", () => {
    assert.equal(resolveApprovalOption(null, "approve"), "approve");
    assert.equal(resolveApprovalOption({ options: [] }, "deny"), "deny");
  });

  it("o formato de hoje continua funcionando", () => {
    const pending = { options: [{ optionId: "approve" }, { optionId: "deny" }] };

    assert.equal(resolveApprovalOption(pending, "approve"), "approve");
    assert.equal(resolveApprovalOption(pending, "deny"), "deny");
  });

  it("a conferência decidida continua no histórico, com o desfecho", () => {
    // O link "Ver artefato" sumia da mensagem antiga no instante da decisão,
    // e a conversa passava a falar de uma conferência sem lugar nenhum.
    const messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "propose_batch",
            output: { batchId: "bat_1", transactionCount: 4, checksum: { result: "match" } },
          },
        ],
      },
      {
        id: "m2",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "commit_batch",
            output: { batchId: "bat_1", status: "confirmed" },
          },
        ],
      },
    ];

    const proposals = findBatchProposals(messages);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0]?.outcome, "confirmed");
    assert.equal(proposals[0]?.messageId, "m1");
    // E segue sem decisão pendente.
    assert.equal(findOpenBatchProposalLocation(messages), null);
  });

  it("uma fatura corrigida vale pela última leitura, não pela primeira", () => {
    const messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "propose_batch",
            output: { batchId: "bat_1", transactionCount: 5, checksum: { result: "mismatch" } },
          },
        ],
      },
      {
        id: "m2",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "edit_proposed_batch",
            output: { batchId: "bat_1", transactionCount: 4, checksum: { result: "match" } },
          },
        ],
      },
    ];

    const proposals = findBatchProposals(messages);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0]?.messageId, "m2");
    assert.equal(proposals[0]?.outcome, "open");
  });
});
