import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ViewPayloadSchema } from "@clara-financas/views";

import presentView from "../../agent/tools/present_view";
import { ctxFor } from "../helpers/harness";

/**
 * A recusa do painel tem de FALAR.
 *
 * Enquanto a regra de proveniência vivia no `inputSchema`, a recusa acontecia
 * antes do corpo da tool: nenhum resultado, nenhum evento na telemetria, e para
 * o modelo um erro de validação sem saída indicada. O que a pessoa via era
 * silêncio — pedia uma lista e não recebia nada — e `read_tool_events` não tinha
 * o que mostrar depois.
 *
 * Não há banco nestes testes: `present_view` não escreve, só valida.
 */

const ctx = ctxFor("tnt_painel") as never;

/**
 * O input chega ao corpo da tool JÁ validado pelo `inputSchema` — é o eve que
 * faz isso, e é de lá que vêm os defaults (`rows: []`, `transactionIds: []`).
 * Chamar `execute` com o objeto cru testaria um caminho que não existe em
 * produção, então o teste atravessa a mesma porta.
 */
const present = async (payload: unknown) =>
  presentView.execute(ViewPayloadSchema.parse(payload) as never, ctx);

describe("present_view diz por que não desenhou", () => {
  it("linha do razão sem ids volta como erro recuperável, com a saída nomeada", async () => {
    const result = (await present({
      kind: "breakdown",
      title: "Composição do gasto",
      rows: [{ label: "Restaurantes", amount: 124_000, transactionIds: [] }],
    })) as {
      error?: {
        code: string;
        message: string;
        hint?: string;
        retryable: boolean;
      };
    };

    assert.equal(result.error?.code, "painel_sem_proveniencia");
    assert.equal(result.error?.retryable, true);
    // A mensagem aponta a linha, não fala em abstrato.
    assert.match(result.error?.message ?? "", /rows\.0\.transactionIds/);
    // E o hint diz as duas saídas: pegar os ids, ou declarar a base.
    assert.match(result.error?.hint ?? "", /transactionIds/);
    assert.match(result.error?.hint ?? "", /basis/);
    assert.match(result.error?.hint ?? "", /read_batch|query_ledger/);
  });

  it("a mesma linha passa quando declara o que sustenta o número", async () => {
    const result = (await present({
      kind: "proposal",
      title: "Ajuste para fechar a fatura",
      rows: [
        {
          label: "Ajuste de arredondamento",
          amount: 3,
          detail: "diferença da fatura, sem item culpado",
          basis: "document",
        },
      ],
    })) as {
      presented?: string;
      rowsWithDeclaredBasis?: number;
      error?: unknown;
    };

    assert.equal(result.error, undefined);
    assert.equal(result.presented, "proposal");
    // Contado no retorno: é o número que denuncia o abuso do `basis` na
    // telemetria, antes de virar reclamação.
    assert.equal(result.rowsWithDeclaredBasis, 1);
  });

  it("o histórico de faturas passa sem declarar nada — a forma já diz", async () => {
    const result = (await present({
      kind: "invoices",
      title: "Faturas mês a mês",
      rows: [
        { label: "Nubank 07/07/26", amount: 438_792, detail: "vence 07/07" },
      ],
    })) as { presented?: string; provenanceCount?: number; error?: unknown };

    assert.equal(result.error, undefined);
    assert.equal(result.presented, "invoices");
    assert.equal(result.provenanceCount, 0);
  });

  it("conferência aritmeticamente contraditória também explica a recusa", async () => {
    const result = (await present({
      kind: "checksum",
      title: "Conferência",
      batchId: "bat_1",
      declaredTotal: 100,
      extractedTotal: 150,
      difference: 7,
      result: "mismatch",
    })) as { error?: { code: string; message: string } };

    assert.equal(result.error?.code, "painel_sem_proveniencia");
    assert.match(result.error?.message ?? "", /difference/);
  });
});
