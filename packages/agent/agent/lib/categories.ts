/**
 * Reexporte de conveniência: o rótulo puro mora no ledger e o loader no db,
 * porque o web precisa dos dois (o dashboard mostrava "dining" enquanto a
 * conversa dizia "Restaurantes"). As tools do agente continuam importando
 * daqui — o lar mudou, o contrato não.
 */
export { categoryLabel, categorySlug, type CategoryLabels } from "@clara-financas/ledger";
export { loadCategoryLabels } from "@clara-financas/db/category-labels";
