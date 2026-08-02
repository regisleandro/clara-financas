import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { requireTenantCaller } from "../agent/lib/tenant";

describe("identidade herdada por subagentes", () => {
  it("aceita o usuário iniciador quando a sub-sessão não expõe current", () => {
    const initiator = {
      principalType: "user" as const,
      principalId: "usr_initiator",
      attributes: { tenantId: "tnt_initiator" },
    };

    const caller = requireTenantCaller({
      session: {
        auth: { current: null, initiator },
      },
    });

    assert.deepEqual(caller, { tenantId: "tnt_initiator", userId: "usr_initiator" });
  });

  it("continua recusando uma sessão sem usuário autenticado", () => {
    assert.throws(
      () =>
        requireTenantCaller({
          session: { auth: { current: null, initiator: null } },
        }),
      /authenticated tenant user/,
    );
  });
});
