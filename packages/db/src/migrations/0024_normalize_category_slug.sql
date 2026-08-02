-- Normaliza a categoria do razão para SLUG, tirando o prefixo do caminho.
--
-- O conceito de categoria é identificado pelo caminho no bundle
-- (`categories/entertainment`) e o razão sempre guardou o slug
-- (`entertainment`). Mas `propose_batch` e `edit_proposed_batch` aceitavam o
-- campo com um `z.string()` cru, sem normalizar nem validar, e gravavam o que
-- o modelo mandasse — e o modelo tem o caminho fresco em mãos, porque acabou
-- de ler ou criar o conceito.
--
-- Em produção isso apareceu de duas formas, e a segunda é a grave:
--
--  1. o painel mostrava `categories/entertainment` sem tradução, porque o
--     rótulo é procurado por slug;
--  2. `aggregateByCategory` agrupa pelo valor da coluna, então as linhas
--     gravadas de uma forma e da outra viravam DUAS fatias da mesma categoria,
--     cada uma com parte do dinheiro — número errado na tela, não só nome feio.
--
-- A escrita passou a normalizar no schema das tools (`categoryInput`), e a
-- agregação passou a agrupar por slug. Esta migração fecha o terceiro lado: o
-- que já está gravado.
--
-- O `NO FORCE` temporário é o mesmo de 0014, pela mesma razão — e ela quase
-- passou batida aqui. As duas tabelas têm FORCE ROW LEVEL SECURITY, e a
-- política exige `app.tenant_id`, que migração nenhuma define. Rodando como o
-- dono sem BYPASSRLS — que é o papel de produção, `clara_owner`, criado
-- NOSUPERUSER NOBYPASSRLS de propósito — o UPDATE não enxergaria linha nenhuma
-- e a migração terminaria VERDE tendo alterado zero. É o pior desfecho
-- possível: não falha e não corrige. No desenvolvimento local o
-- `DATABASE_ADMIN_URL` costuma ser superuser, que ignora RLS, então rodar aqui
-- não revelaria nada.
--
-- Papéis de aplicação não são o dono, então continuam sob RLS o tempo todo: a
-- janela do NO FORCE não afrouxa o isolamento de ninguém em runtime.
--
-- É segura de rodar mais de uma vez: só toca linha cujo valor começa com
-- `categories/`, e depois de rodar não existe mais nenhuma.
ALTER TABLE "transactions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "transactions"
SET "category" = substring("category" from 12)
WHERE "category" LIKE 'categories/%';--> statement-breakpoint
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- O mesmo valor viaja na trilha de auditoria da reclassificação, e ela é lida
-- para mostrar "de X para Y" — sem isto a trilha continuaria dizendo
-- `categories/entertainment` numa tela que agora diz "Entretenimento".
ALTER TABLE "transaction_reclassifications" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "transaction_reclassifications"
SET "previous_value" = substring("previous_value" from 12)
WHERE "previous_value" LIKE 'categories/%';--> statement-breakpoint
UPDATE "transaction_reclassifications"
SET "new_value" = substring("new_value" from 12)
WHERE "new_value" LIKE 'categories/%';--> statement-breakpoint
ALTER TABLE "transaction_reclassifications" FORCE ROW LEVEL SECURITY;
