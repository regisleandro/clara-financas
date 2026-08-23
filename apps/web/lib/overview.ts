import "server-only";

import { fetchOverview } from "@/lib/ledger-api";
import { adaptOverview, type Overview } from "@/lib/overview-model";

export type { Overview } from "@/lib/overview-model";

export async function loadOverview(
  agentHost: string,
  tenantId: string,
  userId: string,
  selection: { month?: string; issuer?: string } = {},
): Promise<Overview> {
  const response = await fetchOverview(agentHost, tenantId, userId, selection);
  return adaptOverview(response);
}
