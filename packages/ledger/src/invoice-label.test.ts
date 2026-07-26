import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatInvoiceLabel } from "./invoice-label";

describe("formatInvoiceLabel", () => {
  it("usa origem e vencimento no formato reconhecível", () => {
    assert.equal(
      formatInvoiceLabel({
        issuer: "Nubank",
        dueDate: "2026-07-07",
        periodEnd: "2026-06-30",
      }),
      "Nubank 07/07/26",
    );
  });

  it("usa o fim do período quando não há vencimento", () => {
    assert.equal(
      formatInvoiceLabel({ issuer: "Itaú", periodEnd: "2026-01-10" }),
      "Itaú 10/01/26",
    );
  });

  it("não depende de nome de arquivo", () => {
    assert.equal(
      formatInvoiceLabel({ issuer: null, dueDate: null, periodEnd: null }),
      "Fatura",
    );
  });
});
