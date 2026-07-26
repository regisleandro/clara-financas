import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { openSealedInput, sealInput } from "@clara-financas/auth/sealed-input";

const secret = "uma-chave-de-teste-com-mais-de-trinta-e-dois-caracteres";

describe("credencial efêmera de PDF", () => {
  it("protege e recupera a senha com escopo e finalidade", async () => {
    const token = await sealInput(
      {
        tenantId: "tenant-a",
        requestId: "request-1",
        purpose: "pdf_password",
        value: "senha-real",
        expiresAt: Date.now() + 60_000,
      },
      secret,
    );

    assert.doesNotMatch(token, /senha-real/);
    assert.deepEqual(await openSealedInput(token, secret), {
      tenantId: "tenant-a",
      requestId: "request-1",
      purpose: "pdf_password",
      value: "senha-real",
      expiresAt: (await openSealedInput(token, secret)).expiresAt,
    });
  });

  it("recusa envelope adulterado ou expirado", async () => {
    const expired = await sealInput(
      {
        tenantId: "tenant-a",
        requestId: "request-1",
        purpose: "pdf_password",
        value: "segredo",
        expiresAt: Date.now() - 1,
      },
      secret,
    );

    await assert.rejects(openSealedInput(expired, secret), /expirado/);
    await assert.rejects(openSealedInput(`${expired.slice(0, -1)}x`, secret));
  });
});
