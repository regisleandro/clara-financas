-- Refaz a normalização de categoria nos bancos onde a 0024 não fez nada.
--
-- A 0024 saiu com três `UPDATE` sobre tabelas com FORCE ROW LEVEL SECURITY e
-- sem suspender a política. Rodando como o dono do schema sem BYPASSRLS — que
-- é o papel de produção — a política exige `app.tenant_id`, que migração
-- nenhuma define, e nenhuma linha é alcançada. Ela terminou com sucesso em
-- produção tendo alterado ZERO linhas, e o `db-migrate` reportou verde.
--
-- A 0024 foi corrigida no mesmo commit desta, para que um banco NOVO nasça
-- certo e para que o teste `migrations.test.ts` valha para os dois arquivos.
-- Mas migração aplicada não volta: o drizzle registra a execução pelo journal
-- e nunca reexecuta o que já rodou. Daí este arquivo — ele existe para os
-- bancos que já passaram pela versão defeituosa.
--
-- Em banco novo é inofensiva: a 0024 corrigida já terá normalizado tudo, e
-- aqui não sobra linha com o prefixo. As duas são idempotentes pela mesma
-- razão — só tocam o que ainda começa com `categories/`.
ALTER TABLE "transactions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "transactions"
SET "category" = substring("category" from 12)
WHERE "category" LIKE 'categories/%';--> statement-breakpoint
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transaction_reclassifications" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "transaction_reclassifications"
SET "previous_value" = substring("previous_value" from 12)
WHERE "previous_value" LIKE 'categories/%';--> statement-breakpoint
UPDATE "transaction_reclassifications"
SET "new_value" = substring("new_value" from 12)
WHERE "new_value" LIKE 'categories/%';--> statement-breakpoint
ALTER TABLE "transaction_reclassifications" FORCE ROW LEVEL SECURITY;
