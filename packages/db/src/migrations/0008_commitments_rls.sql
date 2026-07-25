-- RLS dos compromissos. Mesmo padrão das demais tabelas de tenant: sem
-- app.tenant_id definido, current_setting devolve NULL, nada casa, e o
-- comportamento é falhar fechado.
ALTER TABLE "commitments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commitments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "commitments_tenant_isolation" ON "commitments"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
