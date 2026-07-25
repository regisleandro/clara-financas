-- RLS dos avisos proativos. Mesmo padrão: falha fechado sem app.tenant_id.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "notifications_tenant_isolation" ON "notifications"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
