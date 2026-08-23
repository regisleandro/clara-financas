import "server-only";

import { mintAgentToken } from "@/lib/agent-token";

/**
 * Cliente do `/api/ledger/*` do serviço Python, para Server Components.
 *
 * O serviço Python é o único dono do cálculo (FR-017): esta camada só busca
 * e não recalcula nada — nem soma, nem agrega, nem decide o que é "gasto".
 */
async function getLedgerApi<T>(
  agentHost: string,
  tenantId: string,
  userId: string,
  path: string,
): Promise<T> {
  const token = await mintAgentToken(tenantId, userId);
  const response = await fetch(`${agentHost}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Falha ao consultar ${path}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export type OverviewResponse = {
  months: string[];
  issuers: Array<{ key: string; label: string }>;
  selectedMonth: string | null;
  selectedIssuer: string;
  total: number;
  credits: number;
  net: number;
  comparison: {
    previousMonth: string;
    previousTotal: number;
    delta: number;
    deltaPercent: number;
  } | null;
  spark: number[];
  range: { from: string; to: string } | null;
  categories: Array<{
    category: string | null;
    label: string;
    value: number;
    share: number;
    count: number;
  }>;
  insight: { category: string | null; label: string; deltaRatio: number } | null;
};

export function fetchOverview(
  agentHost: string,
  tenantId: string,
  userId: string,
  selection: { month?: string; issuer?: string } = {},
): Promise<OverviewResponse> {
  const params = new URLSearchParams();
  if (selection.month !== undefined) params.set("month", selection.month);
  if (selection.issuer !== undefined) params.set("issuer", selection.issuer);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return getLedgerApi<OverviewResponse>(agentHost, tenantId, userId, `/api/ledger/overview${query}`);
}
