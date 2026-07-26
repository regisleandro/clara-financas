CREATE TABLE "agent_tool_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text,
	"turn_id" text,
	"call_id" text,
	"tool_name" text NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"duration_ms" integer,
	"input_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_tool_events_tenant_created_idx" ON "agent_tool_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_tool_events_tenant_status_idx" ON "agent_tool_events" USING btree ("tenant_id","status");--> statement-breakpoint
-- RLS da telemetria. Mesmo padrão das demais: falha fechado sem app.tenant_id.
-- Um log de execução escapando do escopo do tenant seria um vazamento tão real
-- quanto o do razão — ele carrega ids de fatura e de documento.
ALTER TABLE "agent_tool_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_tool_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "agent_tool_events_tenant_isolation" ON "agent_tool_events"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint
GRANT SELECT, INSERT ON "agent_tool_events" TO clara_app;--> statement-breakpoint
-- Trilha de execução é append-only: um agente que pudesse reescrever o próprio
-- log tornaria o log inútil justamente no caso que importa.
REVOKE UPDATE, DELETE ON "agent_tool_events" FROM clara_app;
