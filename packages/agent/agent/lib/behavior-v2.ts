export type BehaviorV2Mode = "off" | "shadow" | "canary" | "on";

export function behaviorV2Mode(): BehaviorV2Mode {
  const value = process.env.CLARA_BEHAVIOR_V2_MODE;
  if (value === "off" || value === "shadow" || value === "canary" || value === "on") {
    return value;
  }
  // Desenvolvimento valida o caminho novo; produção exige ativação explícita.
  return process.env.NODE_ENV === "production" ? "off" : "on";
}

function percentage(): number {
  const parsed = Number(process.env.CLARA_BEHAVIOR_V2_PERCENT ?? "0");
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.trunc(parsed))) : 0;
}

function cohort(tenantId: string): number {
  let hash = 2_166_136_261;
  for (const char of tenantId) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % 100;
}

export function behaviorV2Enabled(tenantId: string): boolean {
  const mode = behaviorV2Mode();
  if (mode === "on") return true;
  if (mode !== "canary") return false;
  return cohort(tenantId) < percentage();
}

export function behaviorV2PersistsShadow(): boolean {
  return behaviorV2Mode() !== "off";
}
