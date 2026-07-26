import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { issuerKey, UNKNOWN_ISSUER } from "./issuer";

/**
 * A chave de operadora é usada em DOIS lugares que precisam concordar: a visão
 * por operadora da web e o filtro `issuer` das ferramentas do analista. Estes
 * testes fixam o contrato — grafias da mesma operadora colapsam, e nenhum nome
 * escapa para a chave de "sem operadora".
 */
describe("issuerKey", () => {
  it("iguala acento e caixa", () => {
    assert.equal(issuerKey("Nubank"), issuerKey("NUBANK"));
    assert.equal(issuerKey("Itaú"), issuerKey("itau"));
    assert.equal(issuerKey("C6 Bank"), "c6-bank");
  });

  it("espaçamento é identidade: grafias com separação diferente não colapsam", () => {
    // Limitação conhecida e deliberada: mudar isto mudaria as chaves de URL da
    // visão por operadora. O snapshot entrega ao modelo as grafias EXATAS dos
    // documentos, então o filtro nunca precisa adivinhar a separação.
    assert.notEqual(issuerKey("Nubank"), issuerKey("nu bank"));
  });

  it("distingue operadoras diferentes", () => {
    assert.notEqual(issuerKey("Nubank"), issuerKey("Itaú"));
  });

  it("sem operadora tem chave própria", () => {
    assert.equal(issuerKey(null), UNKNOWN_ISSUER);
  });

  it("nome que o slug descartaria não colide com 'sem operadora'", () => {
    const key = issuerKey("!!!");
    assert.notEqual(key, UNKNOWN_ISSUER);
    assert.match(key, /^operadora-/);
  });
});
