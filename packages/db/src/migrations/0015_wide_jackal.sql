-- Atestado de revisão humana.
--
-- A trilha de reclassificação registra o que MUDOU. A revisão manual, na maior
-- parte dos casos, não muda nada: a pessoa abre o item de confiança baixa,
-- confere contra a fatura e conclui que a leitura estava certa. Essa conclusão
-- também é informação, e sem lugar para guardá-la a fila devolveria os mesmos
-- itens para sempre.
--
-- Os dois campos ficam FORA da lista de imutáveis do trigger (migração 0004)
-- de propósito: atestar não reescreve o razão. Nenhum número muda por causa
-- deles — o que muda é a fila saber o que já foi olhado.
ALTER TABLE "transactions" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
CREATE INDEX "transactions_tenant_reviewed_idx" ON "transactions" USING btree ("tenant_id","reviewed_at");