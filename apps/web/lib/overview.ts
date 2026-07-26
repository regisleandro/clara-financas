import "server-only";

import { loadCategoryLabels } from "@clara-financas/db/category-labels";

import { loadLedgerView } from "@/lib/ledger";
import {
  buildOverview,
  type Overview,
} from "@/lib/overview-model";

export type { Overview } from "@/lib/overview-model";

export async function loadOverview(
  tenantId: string,
  selection: { month?: string; issuer?: string } = {},
): Promise<Overview> {
  const [{ rows }, labels] = await Promise.all([
    loadLedgerView(tenantId),
    loadCategoryLabels(tenantId),
  ]);

  return buildOverview(rows, labels, selection);
}
