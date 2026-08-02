-- Zera categoria que não existe como conceito, registrando na trilha.
--
-- O razão guardava categorias que nunca foram criadas: `services`, `other` e
-- `education` foram INVENTADAS na extração e escritas direto, porque
-- `propose_batch` aceitava o campo sem validar. Sem conceito não há `title` em
-- português, então a tela mostrava o identificador cru — que é inglês. E pior
-- que o nome: `aggregateByCategory` somava uma fatia que a pessoa nunca
-- aprovou.
--
-- A fronteira foi fechada (`write-proposed-batch` derruba para `null` e avisa
-- quais derrubou). Esta migração trata o que já entrou.
--
-- `null` e não "cria os conceitos que faltam": o produto foi desenhado para a
-- taxonomia ser INFERIDA e aprovada pela pessoa (ver f33e977, "taxonomia fixa
-- era erro de desenho"). Escolher aqui os nomes e as fronteiras de três
-- categorias seria repetir, numa migração, exatamente o erro que aquele commit
-- corrigiu. Zeradas, as linhas entram na fila de revisão, o guarda-livros
-- propõe, e a categoria nasce pelo gate — com o nome que quem gasta escolher.
--
-- A perda é registrada: cada linha zerada vira uma entrada em
-- `transaction_reclassifications`, que é a trilha que o produto já usa para
-- "de X para Y". Zerar em silêncio trocaria um defeito visível por um
-- invisível.
--
-- O NO FORCE é o de sempre (ver 0014 e o teste `migrations.test.ts`): as três
-- tabelas têm RLS forçada, migração não define `app.tenant_id`, e o papel de
-- produção é o dono sem BYPASSRLS.
ALTER TABLE "transactions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concepts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transaction_reclassifications" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

INSERT INTO "transaction_reclassifications"
  ("id", "tenant_id", "transaction_id", "field", "previous_value", "new_value", "author", "reason")
SELECT
  'rcl_' || replace(gen_random_uuid()::text, '-', ''),
  t."tenant_id",
  t."id",
  'category',
  t."category",
  NULL,
  'migration/0026',
  'Categoria sem conceito correspondente — nunca foi criada nem aprovada. Zerada para voltar à fila de revisão.'
FROM "transactions" t
WHERE t."category" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "concepts" c
    WHERE c."tenant_id" = t."tenant_id"
      AND c."type" = 'Category'
      AND (c."concept_id" = t."category" OR c."concept_id" = 'categories/' || t."category")
  );--> statement-breakpoint

UPDATE "transactions" t
SET "category" = NULL
WHERE t."category" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "concepts" c
    WHERE c."tenant_id" = t."tenant_id"
      AND c."type" = 'Category'
      AND (c."concept_id" = t."category" OR c."concept_id" = 'categories/' || t."category")
  );--> statement-breakpoint

ALTER TABLE "transaction_reclassifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concepts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;
