import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  behaviorV2Enabled,
  behaviorV2Mode,
  behaviorV2PersistsShadow,
} from "../agent/lib/behavior-v2";

const originalMode = process.env.CLARA_BEHAVIOR_V2_MODE;
const originalPercent = process.env.CLARA_BEHAVIOR_V2_PERCENT;

afterEach(() => {
  if (originalMode === undefined) delete process.env.CLARA_BEHAVIOR_V2_MODE;
  else process.env.CLARA_BEHAVIOR_V2_MODE = originalMode;
  if (originalPercent === undefined) delete process.env.CLARA_BEHAVIOR_V2_PERCENT;
  else process.env.CLARA_BEHAVIOR_V2_PERCENT = originalPercent;
});

describe("rollout dos contratos de comportamento v2", () => {
  it("off oferece rollback completo sem persistência shadow", () => {
    process.env.CLARA_BEHAVIOR_V2_MODE = "off";
    assert.equal(behaviorV2Mode(), "off");
    assert.equal(behaviorV2Enabled("tenant_a"), false);
    assert.equal(behaviorV2PersistsShadow(), false);
  });

  it("shadow persiste evidência sem trocar o contrato entregue", () => {
    process.env.CLARA_BEHAVIOR_V2_MODE = "shadow";
    assert.equal(behaviorV2Enabled("tenant_a"), false);
    assert.equal(behaviorV2PersistsShadow(), true);
  });

  it("canary respeita limites e on ativa todos os tenants", () => {
    process.env.CLARA_BEHAVIOR_V2_MODE = "canary";
    process.env.CLARA_BEHAVIOR_V2_PERCENT = "0";
    assert.equal(behaviorV2Enabled("tenant_a"), false);
    process.env.CLARA_BEHAVIOR_V2_PERCENT = "100";
    assert.equal(behaviorV2Enabled("tenant_a"), true);

    process.env.CLARA_BEHAVIOR_V2_MODE = "on";
    assert.equal(behaviorV2Enabled("tenant_a"), true);
  });
});
