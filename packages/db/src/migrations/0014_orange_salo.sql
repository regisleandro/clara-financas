-- B5: num índice único do Postgres, NULLs são distintos entre si — com
-- `counterparty` nulo o ON CONFLICT nunca disparava e cada `save_commitment`
-- criava uma linha nova, e o cron avisava N vezes o mesmo vencimento.
-- O índice novo usa coalesce('') para tratar nulo como valor, e é parcial:
-- lembretes `custom` são livres e não devem colidir entre si.
--
-- Antes de apertar a unicidade, remove as duplicatas que o índice antigo
-- deixou passar, preservando a linha mais recente de cada grupo.
--
-- O NO FORCE temporário existe porque a tabela tem FORCE ROW LEVEL SECURITY
-- (0008): se a migração rodar como o dono sem BYPASSRLS, o DELETE não veria
-- linha nenhuma e a criação do índice falharia com as duplicatas intactas.
-- Papéis de aplicação não são o dono, então continuam sob RLS o tempo todo.
ALTER TABLE "commitments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DELETE FROM "commitments" a
USING "commitments" b
WHERE a.kind <> 'custom'
  AND b.kind = a.kind
  AND b.tenant_id = a.tenant_id
  AND coalesce(b.counterparty, '') = coalesce(a.counterparty, '')
  AND (b.updated_at > a.updated_at OR (b.updated_at = a.updated_at AND b.id > a.id));--> statement-breakpoint
ALTER TABLE "commitments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "commitments_tenant_kind_counterparty_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "commitments_tenant_kind_counterparty_idx" ON "commitments" USING btree ("tenant_id","kind",coalesce("counterparty", '')) WHERE "commitments"."kind" <> 'custom';
