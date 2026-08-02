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
-- É segura de rodar mais de uma vez: só toca linha cujo valor começa com
-- `categories/`, e depois de rodar não existe mais nenhuma.
update "transactions"
set "category" = substring("category" from 12)
where "category" like 'categories/%';

-- O mesmo valor viaja na trilha de auditoria da reclassificação, e ela é lida
-- para mostrar "de X para Y" — sem isto a trilha continuaria dizendo
-- `categories/entertainment` numa tela que agora diz "Entretenimento".
update "transaction_reclassifications"
set "previous_value" = substring("previous_value" from 12)
where "previous_value" like 'categories/%';

update "transaction_reclassifications"
set "new_value" = substring("new_value" from 12)
where "new_value" like 'categories/%';
