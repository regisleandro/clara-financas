CREATE TABLE "extraction_stagings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_id" text NOT NULL,
	"parent_session_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "extraction_stagings_tenant_document_idx" ON "extraction_stagings" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "extraction_stagings_tenant_created_idx" ON "extraction_stagings" USING btree ("tenant_id","created_at");--> statement-breakpoint
-- RLS da staging de extração. Mesmo padrão das demais: falha fechado sem
-- app.tenant_id. A staging carrega o conteúdo financeiro completo de uma
-- fatura — o vazamento seria tão real quanto o do razão.
ALTER TABLE "extraction_stagings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "extraction_stagings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "extraction_stagings_tenant_isolation" ON "extraction_stagings"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint
-- Staging é descartável por construção: a proposta que a consome apaga a
-- linha, e uma extração nova substitui a anterior. DELETE faz parte do
-- contrato; UPDATE não — extração não se edita, se refaz.
GRANT SELECT, INSERT, DELETE ON "extraction_stagings" TO clara_app;--> statement-breakpoint
REVOKE UPDATE ON "extraction_stagings" FROM clara_app;
