-- RLS e imutabilidade da trilha de recategorização.
-- Mesmo padrão das demais tabelas de tenant: falha fechado sem app.tenant_id,
-- e a trilha é append-only, porque trilha que se reescreve não é trilha.
ALTER TABLE "transaction_reclassifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transaction_reclassifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "reclassifications_tenant_isolation" ON "transaction_reclassifications"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "transaction_reclassifications" FROM clara_app;
